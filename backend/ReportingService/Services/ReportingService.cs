using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Google.Protobuf.WellKnownTypes;
using Grpc.Core;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Reporting;
using StackExchange.Redis;

namespace ReportingService.Services;

public class TransactionReportingService : TransactionService.TransactionServiceBase
{
    private const int MaxConcurrentStreams = 10;
    private const int DefaultBatchSize = 100;
    private const int CacheTtlSeconds = 2;
    private const int ClientRateLimitPerSecond = 120;
    private const int ClientRateLimitBurst = 200;
    private static int _activeStreams;
    private static readonly ConcurrentDictionary<string, int> BatchIndices = new();
    private static readonly ConcurrentDictionary<string, TokenBucket> ClientBuckets = new();
    private static readonly string[] Categories =
    [
        "RETAIL",
        "FOOD",
        "TRAVEL",
        "TECH",
        "HEALTH",
        "UTILITIES"
    ];
    private static readonly Random RandomInstance = Random.Shared;

    private readonly IDistributedCache _cache;
    private readonly ILogger<TransactionReportingService> _logger;

    public TransactionReportingService(IDistributedCache cache, ILogger<TransactionReportingService> logger)
    {
        _cache = cache;
        _logger = logger;
    }

    public override async Task StreamTransactions(
        ReportRequest request,
        IServerStreamWriter<TransactionResponse> responseStream,
        ServerCallContext context)
    {
        // Simple guardrail so one instance cannot be overloaded during demos.
        var current = Interlocked.Increment(ref _activeStreams);

        if (current > MaxConcurrentStreams)
        {
            ServiceMetrics.RateLimited();
            Interlocked.Decrement(ref _activeStreams);
            throw new RpcException(new Status(
                StatusCode.ResourceExhausted,
                "Too many concurrent transaction streams."));
        }

        ServiceMetrics.StreamOpened();

        try
        {

            var cancellationToken = context.CancellationToken;
            var clientId = string.IsNullOrWhiteSpace(request.ClientId) ? "anonymous" : request.ClientId;
            var cacheKey = $"hot_transactions:{clientId}";
            // Keep a reasonable batch size so we can recycle hot data from Redis.
            var batchSize = request.BatchSize > 0 ? request.BatchSize : DefaultBatchSize;
            var bucket = ClientBuckets.GetOrAdd(
                clientId,
                _ => new TokenBucket(ClientRateLimitBurst, ClientRateLimitPerSecond));

            while (!cancellationToken.IsCancellationRequested)
            {
                if (!bucket.TryConsume(1))
                {
                    ServiceMetrics.RateLimited();
                    await Task.Delay(20, cancellationToken);
                    continue;
                }

                var transaction = await GetOrCreateTransactionAsync(cacheKey, batchSize, cancellationToken);
                await responseStream.WriteAsync(transaction);
                ServiceMetrics.MessageSent();
                await Task.Delay(10, cancellationToken);
            }
        }
        catch (OperationCanceledException) when (context.CancellationToken.IsCancellationRequested)
        {
            _logger.LogInformation("StreamTransactions canceled for client {ClientId}.", request.ClientId);
        }
        finally
        {
            Interlocked.Decrement(ref _activeStreams);
            ServiceMetrics.StreamClosed();
        }
    }

    private async Task<TransactionResponse> GetOrCreateTransactionAsync(
        string cacheKey,
        int batchSize,
        CancellationToken cancellationToken)
    {
        var cachedJson = await _cache.GetStringAsync(cacheKey, cancellationToken);
        if (!string.IsNullOrWhiteSpace(cachedJson))
        {
            try
            {
                var cached = JsonSerializer.Deserialize<CachedBatch>(cachedJson);
                if (cached?.Items?.Length > 0)
                {
                    ServiceMetrics.CacheHit();
                    // Rotate through cached items so each stream sees variety without extra load.
                    var index = BatchIndices.AddOrUpdate(
                        cacheKey,
                        0,
                        (_, currentIndex) => (currentIndex + 1) % cached.Items.Length);
                    return cached.Items[index];
                }
            }
            catch (JsonException ex)
            {
                _logger.LogWarning(ex, "Invalid cached transaction payload for key {CacheKey}.", cacheKey);
            }
        }

        ServiceMetrics.CacheMiss();

        BatchIndices.TryRemove(cacheKey, out _);

        var batch = new CachedBatch
        {
            Items = GenerateMockTransactions(Math.Max(batchSize, 1))
        };
        var payload = JsonSerializer.Serialize(batch);
        var cacheOptions = new DistributedCacheEntryOptions
        {
            // Short TTL keeps data fresh while still avoiding DB hits (if a DB existed).
            AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(CacheTtlSeconds)
        };

        await _cache.SetStringAsync(cacheKey, payload, cacheOptions, cancellationToken);
        return batch.Items[0];
    }

    private static TransactionResponse GenerateMockTransaction()
    {
        var roll = RandomInstance.NextDouble();
        var status = roll switch
        {
            < 0.80 => "COMPLETED",
            < 0.95 => "PENDING",
            _ => "FAILED"
        };

        var amount = Math.Round(1 + (RandomInstance.NextDouble() * 9998.99), 2);

        return new TransactionResponse
        {
            Id = Guid.NewGuid().ToString("N"),
            Category = Categories[RandomInstance.Next(Categories.Length)],
            Amount = amount,
            Currency = "RM",
            Timestamp = Timestamp.FromDateTime(DateTime.UtcNow),
            Status = status
        };
    }

    private static TransactionResponse[] GenerateMockTransactions(int count)
    {
        var results = new TransactionResponse[count];
        for (var i = 0; i < count; i++)
        {
            results[i] = GenerateMockTransaction();
        }

        return results;
    }

    private sealed class CachedBatch
    {
        public TransactionResponse[] Items { get; set; } = Array.Empty<TransactionResponse>();
    }

    private sealed class TokenBucket
    {
        private readonly double _capacity;
        private readonly double _refillPerSecond;
        private double _tokens;
        private long _lastRefillTicks;
        private readonly object _lock = new();

        public TokenBucket(double capacity, double refillPerSecond)
        {
            _capacity = capacity;
            _refillPerSecond = refillPerSecond;
            _tokens = capacity;
            _lastRefillTicks = Stopwatch.GetTimestamp();
        }

        public bool TryConsume(double amount)
        {
            lock (_lock)
            {
                var now = Stopwatch.GetTimestamp();
                var elapsedSeconds = (now - _lastRefillTicks) / (double)Stopwatch.Frequency;
                if (elapsedSeconds > 0)
                {
                    _tokens = Math.Min(_capacity, _tokens + (elapsedSeconds * _refillPerSecond));
                    _lastRefillTicks = now;
                }

                if (_tokens < amount)
                {
                    return false;
                }

                _tokens -= amount;
                return true;
            }
        }
    }
}

// Register in Program.cs: builder.Services.AddHostedService<TransactionUpdateSubscriber>();
// Cache invalidation strategy: publish the affected client id to Redis; subscribers delete the hot
// batch so active streams refresh on the next iteration (at most one stale item is sent).
public sealed class TransactionUpdateSubscriber : BackgroundService
{
    private const string ChannelName = "transaction-updates";

    private readonly IConnectionMultiplexer _redis;
    private readonly ILogger<TransactionUpdateSubscriber> _logger;

    public TransactionUpdateSubscriber(IConnectionMultiplexer redis, ILogger<TransactionUpdateSubscriber> logger)
    {
        _redis = redis;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var subscriber = _redis.GetSubscriber();

        await subscriber.SubscribeAsync(ChannelName, (channel, value) =>
        {
            var clientId = (string)value;
            if (string.IsNullOrWhiteSpace(clientId))
            {
                return;
            }

            var cacheKey = $"hot_transactions:{clientId}";
            _redis.GetDatabase().KeyDelete(cacheKey);

            // If a stream is mid-flight, it may send one stale item, but the next loop
            // sees the cache miss and regenerates fresh data on the following iteration.
            _logger.LogInformation("Invalidated cache for {CacheKey} via {Channel}.", cacheKey, (string)channel);
        });

        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            // Expected during shutdown.
        }
    }
}
