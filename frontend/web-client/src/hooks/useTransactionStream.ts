import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../store/store';
import { flushBuffer, hydrateFromCache, setStatus } from '../store/transactionSlice';
import type { Transaction } from '../store/transactionSlice';
import { TransactionServiceClient } from '../TransactionServiceClientPb';
import * as TransactionPb from '../Transaction_pb';

const client = new TransactionServiceClient('http://localhost:7000');
const STORAGE_KEY = 'bre.transactions.v1';
const MIN_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 400;
const HIGH_WATERMARK = 600;
const LOW_WATERMARK = 150;
const ADJUST_COOLDOWN_MS = 5000;

export function useTransactionStream() {
  const dispatch = useAppDispatch();
  const transactions = useAppSelector((state) => state.transactions.transactions);
  const bufferRef = useRef<Transaction[]>([]);
  const streamRef = useRef<any>(null);
  const retryDelayRef = useRef(1000);
  const mountedRef = useRef(true);
  const clientIdRef = useRef(`browser-${Date.now()}`);
  const currentBatchSizeRef = useRef(100);
  const lastAdjustRef = useRef(0);
  const restartInProgressRef = useRef(false);

  const connect = (batchSize = currentBatchSizeRef.current) => {
    if (!mountedRef.current) return;

    const request = new TransactionPb.ReportRequest();
    request.setClientId(clientIdRef.current);
    request.setBatchSize(batchSize);
    currentBatchSizeRef.current = batchSize;

    const stream = client.streamTransactions(request, {});
    streamRef.current = stream;
    restartInProgressRef.current = false;

    stream.on('data', (response: any) => {
      const ts = response.getTimestamp();
      const nowMs = Date.now();
      const fallbackSeconds = Math.floor(nowMs / 1000);
      const fallbackNanos = (nowMs % 1000) * 1_000_000;
      const seconds = ts ? Number(ts.getSeconds()) || 0 : fallbackSeconds;
      const nanos = ts && typeof ts.getNanos === 'function' ? ts.getNanos() : fallbackNanos;
      const isAnomaly =
        typeof response.getIsAnomaly === 'function' ? response.getIsAnomaly() : false;
      bufferRef.current.push({
        id: response.getId(),
        category: response.getCategory(),
        amount: response.getAmount(),
        currency: response.getCurrency(),
        status: response.getStatus(),
        timestampSeconds: seconds,
        timestampNanos: nanos,
        isAnomaly,
      });
    });

    stream.on('error', () => {
      if (restartInProgressRef.current) return;
      dispatch(setStatus('cached-view'));
      if (mountedRef.current) {
        // Exponential backoff so we do not spam reconnects if the server is down.
        setTimeout(() => {
          retryDelayRef.current = Math.min(retryDelayRef.current * 2, 30000);
          connect();
        }, retryDelayRef.current);
      }
    });

    stream.on('end', () => {
      if (restartInProgressRef.current) return;
      if (mountedRef.current) {
        dispatch(setStatus('reconnecting'));
        setTimeout(() => {
          retryDelayRef.current = Math.min(retryDelayRef.current * 2, 30000);
          connect();
        }, retryDelayRef.current);
      }
    });

    retryDelayRef.current = 1000;
    dispatch(setStatus('live'));
  };

  const restartStream = (batchSize: number) => {
    if (!mountedRef.current) return;
    restartInProgressRef.current = true;
    streamRef.current?.cancel();
    setTimeout(() => {
      connect(batchSize);
    }, 200);
  };

  const maybeAdjustBatchSize = (bufferedCount: number) => {
    const now = Date.now();
    if (now - lastAdjustRef.current < ADJUST_COOLDOWN_MS) return;

    let nextBatchSize = currentBatchSizeRef.current;
    if (bufferedCount > HIGH_WATERMARK && nextBatchSize < MAX_BATCH_SIZE) {
      nextBatchSize = Math.min(MAX_BATCH_SIZE, nextBatchSize * 2);
    } else if (bufferedCount < LOW_WATERMARK && nextBatchSize > MIN_BATCH_SIZE) {
      nextBatchSize = Math.max(MIN_BATCH_SIZE, Math.floor(nextBatchSize / 2));
    }

    if (nextBatchSize !== currentBatchSizeRef.current) {
      lastAdjustRef.current = now;
      restartStream(nextBatchSize);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as unknown[];
        if (Array.isArray(parsed)) {
          const normalized = parsed.flatMap((item) => {
            if (!item || typeof item !== 'object') return [];
            const record = item as Record<string, unknown>;
            if (
              typeof record.timestampSeconds === 'number' &&
              typeof record.timestampNanos === 'number'
            ) {
              return [item as Transaction];
            }
            if (typeof record.timestamp === 'number') {
              const legacyMs = record.timestamp;
              const legacySeconds = Math.floor(legacyMs / 1000);
              const legacyNanos = Math.floor((legacyMs % 1000) * 1_000_000);
              const { timestamp, ...rest } = record;
              return [
                {
                  ...rest,
                  timestampSeconds: legacySeconds,
                  timestampNanos: legacyNanos,
                } as Transaction,
              ];
            }
            return [];
          });

          dispatch(hydrateFromCache(normalized));
        }
      } catch {
        // Ignore invalid cache payloads.
      }
    }

    connect();

    // Buffer stream packets and flush every 500ms to avoid React render storms.
    const flushInterval = setInterval(() => {
      const bufferedCount = bufferRef.current.length;
      if (bufferedCount > 0) {
        maybeAdjustBatchSize(bufferedCount);
        dispatch(flushBuffer([...bufferRef.current]));
        bufferRef.current = [];
      }
    }, 500);

    return () => {
      mountedRef.current = false;
      streamRef.current?.cancel();
      clearInterval(flushInterval);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
    } catch {
      // Best-effort cache only.
    }
  }, [transactions]);
}