import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

interface Transaction {
  id: string;
  category: string;
  amount: number;
  currency: string;
  status: string;
  timestampSeconds: number;
  timestampNanos: number;
  isAnomaly: boolean;
}

interface TransactionState {
  transactions: Transaction[];
  connectionStatus: 'live' | 'reconnecting' | 'cached-view';
  totalFlushed: number;
  totalRevenue: number;
  mean: number;
  m2: number;
  count: number;
}

const initialState: TransactionState = {
  transactions: [],
  connectionStatus: 'reconnecting',
  totalFlushed: 0,
  totalRevenue: 0,
  mean: 0,
  m2: 0,
  count: 0,
};

const anomalyThreshold = 3;
const minimumSamplesForAnomaly = 30;

const isAnomaly = (amount: number, mean: number, m2: number, count: number) => {
  if (count < minimumSamplesForAnomaly) return false;
  const variance = m2 / Math.max(count - 1, 1);
  if (variance <= 0) return false;
  const stdDev = Math.sqrt(variance);
  return Math.abs(amount - mean) >= anomalyThreshold * stdDev;
};

const recomputeStats = (transactions: Transaction[]) => {
  let mean = 0;
  let m2 = 0;
  let count = 0;

  for (const tx of transactions) {
    count += 1;
    const delta = tx.amount - mean;
    mean += delta / count;
    const delta2 = tx.amount - mean;
    m2 += delta * delta2;
  }

  return { mean, m2, count };
};

const transactionSlice = createSlice({
  name: 'transactions',
  initialState,
  reducers: {
    flushBuffer(state, action: PayloadAction<Transaction[]>) {
      let mean = state.mean;
      let m2 = state.m2;
      let count = state.count;
      let totalRevenue = state.totalRevenue;

      const enriched = action.payload.map((tx) => {
        const flagged = isAnomaly(tx.amount, mean, m2, count);

        totalRevenue += tx.amount;
        count += 1;
        const delta = tx.amount - mean;
        mean += delta / count;
        const delta2 = tx.amount - mean;
        m2 += delta * delta2;

        return { ...tx, isAnomaly: flagged };
      });

      // Prepend new items and cap the list so the UI stays responsive.
      state.transactions = [...enriched, ...state.transactions].slice(0, 10000);
      state.totalFlushed += enriched.length;
      state.totalRevenue = totalRevenue;
      state.mean = mean;
      state.m2 = m2;
      state.count = count;
    },
    hydrateFromCache(state, action: PayloadAction<Transaction[]>) {
      const cached = action.payload.slice(0, 10000);
      const stats = recomputeStats(cached);
      const totalRevenue = cached.reduce((sum, tx) => sum + tx.amount, 0);
      state.transactions = cached;
      state.totalFlushed = cached.length;
      state.totalRevenue = totalRevenue;
      state.mean = stats.mean;
      state.m2 = stats.m2;
      state.count = stats.count;
    },
    setStatus(state, action: PayloadAction<TransactionState['connectionStatus']>) {
      state.connectionStatus = action.payload;
    },
    clearAll(state) {
      state.transactions = [];
      state.totalFlushed = 0;
      state.totalRevenue = 0;
      state.mean = 0;
      state.m2 = 0;
      state.count = 0;
    },
  },
});

export type { Transaction };
export const { flushBuffer, hydrateFromCache, setStatus, clearAll } = transactionSlice.actions;
export default transactionSlice.reducer;