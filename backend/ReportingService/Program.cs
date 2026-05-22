using ReportingService.Services;
using Microsoft.AspNetCore.Builder;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddGrpc();

builder.Services.AddStackExchangeRedisCache(options =>
{
    options.Configuration = "localhost:6379";
});

builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    ConnectionMultiplexer.Connect("localhost:6379"));
builder.Services.AddHostedService<TransactionUpdateSubscriber>();

builder.Services.AddCors(o => o.AddPolicy("AllowAll", builder =>
{
    builder.AllowAnyOrigin()
           .AllowAnyMethod()
           .AllowAnyHeader()
           .WithExposedHeaders(
               "Grpc-Status",
               "Grpc-Message",
               "Grpc-Encoding",
               "Grpc-Accept-Encoding");
}));

var app = builder.Build();

app.UseRouting();
app.UseCors("AllowAll");
app.UseGrpcWeb();

app.MapGrpcService<TransactionReportingService>()
    .EnableGrpcWeb()
    .RequireCors("AllowAll");
app.MapMethods("/reporting.TransactionService/{**catchall}", new[] { "OPTIONS" }, () => Results.Ok())
    .RequireCors("AllowAll");
app.MapGet("/", () => "gRPC backend running");
app.MapGet("/health", () => Results.Json(ServiceMetrics.Snapshot()));
app.MapGet("/metrics", () => Results.Text(ServiceMetrics.Prometheus(), "text/plain"));

app.Run("http://0.0.0.0:7000");