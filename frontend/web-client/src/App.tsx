import { useEffect, useMemo, useState } from 'react';
import { List } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { useTransactionStream } from './hooks/useTransactionStream';
import { useAppSelector } from './store/store';

const CATEGORY_COLORS: Record<string, string> = {
  RETAIL: '#3b82f6',
  FOOD: '#10b981',
  TRAVEL: '#f59e0b',
  TECH: '#8b5cf6',
  HEALTH: '#ef4444',
  UTILITIES: '#6b7280',
};

const statusColor = (status: string) =>
  status === 'COMPLETED' ? '#10b981' : status === 'FAILED' ? '#ef4444' : '#f59e0b';

const formatTimestamp = (seconds: number, nanos: number) => {
  const millis = Math.floor(nanos / 1_000_000);
  const date = new Date(seconds * 1000 + millis);
  const fractional = String(nanos).padStart(9, '0');
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const dayPeriod = parts.find((part) => part.type === 'dayPeriod')?.value;
  const time = parts
    .filter((part) => part.type !== 'dayPeriod')
    .map((part) => part.value)
    .join('')
    .trim();
  return dayPeriod ? `${time}.${fractional} ${dayPeriod}` : `${time}.${fractional}`;
};

type HealthMetrics = {
  activeStreams: number;
  messagesSent: number;
  cacheHitRate: number;
  rateLimited: number;
};

type CategorySummary = {
  label: string;
  count: number;
  color: string;
};

function App() {
  useTransactionStream();

  const { transactions, connectionStatus, totalFlushed, totalRevenue, mean } = useAppSelector(
    (state) => state.transactions
  );
  const [metrics, setMetrics] = useState<HealthMetrics | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchMetrics = async () => {
      try {
        const response = await fetch('http://localhost:7000/health');
        if (!response.ok) return;
        const data = await response.json();
        if (mounted) {
          setMetrics({
            activeStreams: data.activeStreams ?? 0,
            messagesSent: data.messagesSent ?? 0,
            cacheHitRate: data.cacheHitRate ?? 0,
            rateLimited: data.rateLimited ?? 0,
          });
        }
      } catch {
        // Ignore transient connectivity errors.
      }
    };

    fetchMetrics();
    const intervalId = setInterval(fetchMetrics, 2000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, []);

  const stats = useMemo(() => {
    const anomalies = transactions.filter((tx) => tx.isAnomaly).length;
    const avg = totalFlushed > 0 ? mean : 0;
    return { total: totalRevenue, avg, anomalies };
  }, [transactions, totalFlushed, totalRevenue, mean]);

  const categorySummary = useMemo<CategorySummary[]>(() => {
    const summary = Object.keys(CATEGORY_COLORS).reduce((acc, category) => {
      acc[category] = 0;
      return acc;
    }, {} as Record<string, number>);

    for (const tx of transactions) {
      if (summary[tx.category] !== undefined) {
        summary[tx.category] += 1;
      }
    }

    return Object.entries(summary)
      .map(([label, count]) => ({
        label,
        count,
        color: CATEGORY_COLORS[label] ?? '#6b7280',
      }))
      .sort((a, b) => b.count - a.count);
  }, [transactions]);

  const sparklinePoints = useMemo(() => {
    const windowSize = 60;
    const values = transactions.slice(0, windowSize).map((tx) => tx.amount).reverse();
    if (values.length === 0) return '';

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    return values
      .map((value, index) => {
        const x = (index / Math.max(values.length - 1, 1)) * 100;
        const y = 100 - ((value - min) / range) * 100;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [transactions]);

  const listHeight = window.innerHeight - 280;

  const Row = ({ index, style, ariaAttributes }: RowComponentProps) => {
    const tx = transactions[index];
    return (
      <div
        {...ariaAttributes}
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          borderBottom: '1px solid #1f2937',
          fontSize: 13,
        }}
      >
        <span style={{ flex: 2, color: '#9ca3af', fontFamily: 'monospace' }}>
          {tx.id.slice(0, 8)}
        </span>
        <span style={{ flex: 1 }}>
          <span
            style={{
              background: CATEGORY_COLORS[tx.category] ?? '#555',
              color: '#fff',
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 11,
            }}
          >
            {tx.category}
          </span>
        </span>
        <span
          style={{
            flex: 1,
            textAlign: 'right',
            color: tx.isAnomaly ? '#ef4444' : '#f9fafb',
          }}
        >
          RM{tx.amount.toFixed(2)}
        </span>
        <span style={{ flex: 1, textAlign: 'right', color: statusColor(tx.status) }}>
          {tx.status}
        </span>
        <span style={{ flex: 1, textAlign: 'right', color: '#6b7280' }}>
          {formatTimestamp(tx.timestampSeconds, tx.timestampNanos)}
        </span>
      </div>
    );
  };

  const statCards = [
    {
      label: 'Total Revenue',
      value: 'RM' +
        stats.total.toLocaleString('en', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
    },
    { label: 'Avg Transaction', value: 'RM' + stats.avg.toFixed(2) },
    { label: 'Anomalies', value: stats.anomalies.toString() },
  ];

  return (
    <div
      style={{
        background: '#111827',
        minHeight: '100vh',
        color: '#f9fafb',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid #1f2937',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Transaction Dashboard</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background:
                  connectionStatus === 'live'
                    ? '#10b981'
                    : connectionStatus === 'reconnecting'
                      ? '#f59e0b'
                      : '#ef4444',
                display: 'inline-block',
              }}
            />
            <span style={{ fontSize: 13, color: '#9ca3af' }}>
              {connectionStatus === 'live'
                ? 'Live'
                : connectionStatus === 'reconnecting'
                  ? 'Reconnecting...'
                  : 'Cached View'}
            </span>
            <span style={{ fontSize: 13, color: '#6b7280', marginLeft: 16 }}>
              {totalFlushed.toLocaleString()} total received
            </span>
          </div>
          {metrics && (
            <div style={{ fontSize: 12, color: '#9ca3af' }}>
              Streams: {metrics.activeStreams} | Cache hit: {Math.round(metrics.cacheHitRate * 100)}% | Rate limited: {metrics.rateLimited}
            </div>
          )}
        </div>
      </div>

      {connectionStatus === 'cached-view' && (
        <div style={{ background: '#7c2d12', padding: '10px 24px', fontSize: 13 }}>
           Stream disconnected — showing cached data. Attempting to reconnect...
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 16,
          padding: 24,
        }}
      >
        {statCards.map((card) => (
          <div key={card.label} style={{ background: '#1f2937', borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>
              {card.label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          padding: '0 24px 24px',
          display: 'grid',
          gridTemplateColumns: '1.2fr 1fr',
          gap: 16,
        }}
      >
        <div style={{ background: '#1f2937', borderRadius: 8, padding: 16, minHeight: 180 }}>
          <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 12 }}>
            Flow (last 60)
          </div>
          <svg
            viewBox="0 0 100 100"
            width="100%"
            height="110"
            preserveAspectRatio="none"
            style={{ display: 'block' }}
          >
            <g stroke="#334155" strokeWidth="1" opacity="0.7">
              <line x1="0" y1="20" x2="100" y2="20" />
              <line x1="0" y1="40" x2="100" y2="40" />
              <line x1="0" y1="60" x2="100" y2="60" />
              <line x1="0" y1="80" x2="100" y2="80" />
            </g>
            <polyline
              points={sparklinePoints}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="2"
            />
          </svg>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8 }}>
            Visualizing recent transaction amounts.
          </div>
        </div>
        <div style={{ background: '#1f2937', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 12 }}>
            Category Mix
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {categorySummary.map((item) => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 64, fontSize: 11, color: '#9ca3af' }}>{item.label}</div>
                <div style={{ flex: 1, height: 8, background: '#111827', borderRadius: 999 }}>
                  <div
                    style={{
                      width: `${transactions.length ? (item.count / transactions.length) * 100 : 0}%`,
                      height: '100%',
                      borderRadius: 999,
                      background: item.color,
                    }}
                  />
                </div>
                <div style={{ width: 48, fontSize: 11, color: '#9ca3af', textAlign: 'right' }}>
                  {item.count}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          padding: '0 16px',
          marginBottom: 4,
          fontSize: 11,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}
      >
        <span style={{ flex: 2 }}>ID</span>
        <span style={{ flex: 1 }}>Category</span>
        <span style={{ flex: 1, textAlign: 'right' }}>Amount</span>
        <span style={{ flex: 1, textAlign: 'right' }}>Status</span>
        <span style={{ flex: 1, textAlign: 'right' }}>Time</span>
      </div>

      <List
        rowCount={transactions.length}
        rowHeight={48}
        rowComponent={Row}
        rowProps={{}}
        style={{ height: listHeight, width: '100%' }}
      />

      {transactions.length === 0 && (
        <div style={{ textAlign: 'center', padding: 64, color: '#6b7280' }}>
          Connecting to stream...
        </div>
      )}
    </div>
  );
}

export default App;