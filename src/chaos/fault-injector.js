/**
 * ChaosMesh Sentinel - Chaos Engineering Engine
 * Dynamic Fault Injection, Latency Jitter, Error Rate & Blast Radius Limiter
 * 
 * Author: 🏛️ أ. طارق ابوعشي
 */

export const FaultType = {
  LATENCY: 'LATENCY',
  ERROR: 'ERROR',
  BLACKHOLE: 'BLACKHOLE'
};

export class FaultInjector {
  constructor() {
    // Map of serviceName -> rule
    this.rules = new Map();
    this.injectedEvents = [];
    this.maxEventLogs = 100;
  }

  setFaultRule(serviceName, rule = {}) {
    const defaultRule = {
      enabled: true,
      faultType: rule.faultType || FaultType.LATENCY,
      latencyMs: rule.latencyMs || 0,
      jitterMs: rule.jitterMs || 0,
      errorRate: rule.errorRate !== undefined ? rule.errorRate : 0, // 0.0 - 1.0
      errorMessage: rule.errorMessage || 'Chaos Injected Failure',
      errorCode: rule.errorCode || 500
    };
    this.rules.set(serviceName, defaultRule);
    return defaultRule;
  }

  removeFaultRule(serviceName) {
    return this.rules.delete(serviceName);
  }

  clearRules() {
    this.rules.clear();
  }

  getRule(serviceName) {
    return this.rules.get(serviceName) || null;
  }

  async intercept(serviceName) {
    const rule = this.rules.get(serviceName);
    if (!rule || !rule.enabled) {
      return { injected: false };
    }

    const event = {
      service: serviceName,
      timestamp: Date.now(),
      faultType: rule.faultType,
      applied: false
    };

    // 1. Blackhole simulation
    if (rule.faultType === FaultType.BLACKHOLE) {
      event.applied = true;
      event.details = 'Traffic dropped (Blackhole Partition)';
      this._logEvent(event);
      throw new Error(`[ChaosMesh] Blackhole Partition: Service '${serviceName}' unreachable`);
    }

    // 2. Latency Injection
    if (rule.latencyMs > 0 || rule.jitterMs > 0) {
      const jitter = rule.jitterMs > 0 ? Math.floor(Math.random() * rule.jitterMs) : 0;
      const totalDelay = rule.latencyMs + jitter;
      if (totalDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, totalDelay));
        event.latencyAddedMs = totalDelay;
        event.applied = true;
      }
    }

    // 3. Error Rate Injection
    if (rule.errorRate > 0) {
      const roll = Math.random();
      if (roll < rule.errorRate) {
        event.applied = true;
        event.details = `Injected Error: ${rule.errorMessage} (Roll: ${roll.toFixed(2)} < ${rule.errorRate})`;
        this._logEvent(event);
        const err = new Error(`[ChaosMesh] ${rule.errorMessage}`);
        err.statusCode = rule.errorCode;
        throw err;
      }
    }

    if (event.applied) {
      this._logEvent(event);
    }

    return { injected: event.applied, details: event };
  }

  _logEvent(event) {
    this.injectedEvents.unshift(event);
    if (this.injectedEvents.length > this.maxEventLogs) {
      this.injectedEvents.pop();
    }
  }

  getHistory() {
    return [...this.injectedEvents];
  }
}
