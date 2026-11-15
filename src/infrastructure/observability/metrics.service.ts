import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly latenciesMs: number[] = [];

  inc(metric: string, value = 1): void {
    this.counters.set(metric, (this.counters.get(metric) ?? 0) + value);
  }

  observeLatency(ms: number): void {
    this.latenciesMs.push(ms);
    if (this.latenciesMs.length > 5000) {
      this.latenciesMs.shift();
    }
  }

  snapshot() {
    const sorted = [...this.latenciesMs].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
    return {
      counters: Object.fromEntries(this.counters.entries()),
      latencyP95Ms: p95,
    };
  }
}
