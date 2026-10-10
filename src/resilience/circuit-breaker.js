/**
 * ChaosMesh Sentinel - Resilience Engine
 * Production-Grade Finite-State Machine Circuit Breaker
 * States: CLOSED, OPEN, HALF_OPEN
 * 
 * Author: 🏛️ أ. طارق ابوعشي
 */

export const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

export class CircuitBreakerOpenError extends Error {
  constructor(message = 'Circuit breaker is OPEN. Fast-failing request.') {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

export class CircuitBreaker {
  constructor(name = 'default-breaker', options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 3;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs || 1000;
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold || 2;

    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.totalRequests = 0;
    this.rejectedRequests = 0;
    this.lastStateChange = Date.now();
    this.lastFailureTime = null;
    this.stateHistory = [
      { from: null, to: CircuitState.CLOSED, timestamp: Date.now(), reason: 'Initial State' }
    ];
  }

  getState() {
    // Check if recovery timeout elapsed while OPEN to transition to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      const now = Date.now();
      if (now - this.lastStateChange >= this.recoveryTimeoutMs) {
        this.transitionTo(CircuitState.HALF_OPEN, 'Recovery timeout elapsed; probing canary requests');
      }
    }
    return this.state;
  }

  transitionTo(newState, reason = '') {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === CircuitState.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
    } else if (newState === CircuitState.HALF_OPEN) {
      this.successCount = 0;
      this.failureCount = 0;
    }

    this.stateHistory.push({
      from: oldState,
      to: newState,
      timestamp: Date.now(),
      reason
    });
  }

  async execute(action, fallback = null) {
    this.totalRequests++;
    const currentState = this.getState();

    if (currentState === CircuitState.OPEN) {
      this.rejectedRequests++;
      if (fallback) {
        return fallback(new CircuitBreakerOpenError(`[${this.name}] Circuit is OPEN`));
      }
      throw new CircuitBreakerOpenError(`[${this.name}] Circuit is OPEN`);
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      if (fallback) {
        return fallback(err);
      }
      throw err;
    }
  }

  onSuccess() {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.transitionTo(CircuitState.CLOSED, `Half-open probe succeeded (${this.successCount} consecutive calls)`);
      }
    } else if (this.state === CircuitState.CLOSED) {
      this.failureCount = 0;
    }
  }

  onFailure(err) {
    this.lastFailureTime = Date.now();
    this.failureCount++;

    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN, `Probe failed during HALF_OPEN: ${err.message || 'Error'}`);
    } else if (this.state === CircuitState.CLOSED) {
      if (this.failureCount >= this.failureThreshold) {
        this.transitionTo(CircuitState.OPEN, `Exceeded failure threshold (${this.failureCount}/${this.failureThreshold})`);
      }
    }
  }

  reset() {
    this.transitionTo(CircuitState.CLOSED, 'Manual reset triggered');
    this.failureCount = 0;
    this.successCount = 0;
    this.rejectedRequests = 0;
  }

  getMetrics() {
    return {
      name: this.name,
      state: this.getState(),
      totalRequests: this.totalRequests,
      failureCount: this.failureCount,
      successCount: this.successCount,
      rejectedRequests: this.rejectedRequests,
      lastStateChange: this.lastStateChange,
      historyCount: this.stateHistory.length
    };
  }
}
