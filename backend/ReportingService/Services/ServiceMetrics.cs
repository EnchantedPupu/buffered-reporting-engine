using System;
using System.Text;
using System.Threading;

namespace ReportingService.Services;

public static class ServiceMetrics
{
    private static long _streamsActive;
    private static long _streamsOpened;
    private static long _streamsClosed;
    private static long _messagesSent;
    private static long _cacheHits;
    private static long _cacheMisses;
    private static long _rateLimited;

    public static void StreamOpened()
    {
        Interlocked.Increment(ref _streamsActive);
        Interlocked.Increment(ref _streamsOpened);
    }

    public static void StreamClosed()
    {
        Interlocked.Decrement(ref _streamsActive);
        Interlocked.Increment(ref _streamsClosed);
    }

    public static void MessageSent() => Interlocked.Increment(ref _messagesSent);

    public static void CacheHit() => Interlocked.Increment(ref _cacheHits);

    public static void CacheMiss() => Interlocked.Increment(ref _cacheMisses);

    public static void RateLimited() => Interlocked.Increment(ref _rateLimited);

    public static MetricsSnapshot Snapshot()
    {
        var hits = Interlocked.Read(ref _cacheHits);
        var misses = Interlocked.Read(ref _cacheMisses);
        var total = hits + misses;

        return new MetricsSnapshot
        {
            ActiveStreams = Interlocked.Read(ref _streamsActive),
            StreamsOpened = Interlocked.Read(ref _streamsOpened),
            StreamsClosed = Interlocked.Read(ref _streamsClosed),
            MessagesSent = Interlocked.Read(ref _messagesSent),
            CacheHits = hits,
            CacheMisses = misses,
            CacheHitRate = total == 0 ? 0 : hits / (double)total,
            RateLimited = Interlocked.Read(ref _rateLimited),
            TimestampUtc = DateTimeOffset.UtcNow
        };
    }

    public static string Prometheus()
    {
        var snapshot = Snapshot();
        var builder = new StringBuilder();

        AppendGauge(builder, "reporting_streams_active", snapshot.ActiveStreams);
        AppendCounter(builder, "reporting_streams_opened_total", snapshot.StreamsOpened);
        AppendCounter(builder, "reporting_streams_closed_total", snapshot.StreamsClosed);
        AppendCounter(builder, "reporting_messages_sent_total", snapshot.MessagesSent);
        AppendCounter(builder, "reporting_cache_hits_total", snapshot.CacheHits);
        AppendCounter(builder, "reporting_cache_misses_total", snapshot.CacheMisses);
        AppendGauge(builder, "reporting_cache_hit_rate", snapshot.CacheHitRate);
        AppendCounter(builder, "reporting_rate_limited_total", snapshot.RateLimited);

        return builder.ToString();
    }

    private static void AppendGauge(StringBuilder builder, string name, double value)
    {
        builder.Append("# TYPE ").Append(name).Append(" gauge\n");
        builder.Append(name).Append(' ').Append(value.ToString("0.########", System.Globalization.CultureInfo.InvariantCulture)).Append('\n');
    }

    private static void AppendCounter(StringBuilder builder, string name, long value)
    {
        builder.Append("# TYPE ").Append(name).Append(" counter\n");
        builder.Append(name).Append(' ').Append(value).Append('\n');
    }

    public sealed class MetricsSnapshot
    {
        public long ActiveStreams { get; init; }
        public long StreamsOpened { get; init; }
        public long StreamsClosed { get; init; }
        public long MessagesSent { get; init; }
        public long CacheHits { get; init; }
        public long CacheMisses { get; init; }
        public double CacheHitRate { get; init; }
        public long RateLimited { get; init; }
        public DateTimeOffset TimestampUtc { get; init; }
    }
}
