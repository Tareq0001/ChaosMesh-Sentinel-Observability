/**
 * ChaosMesh Sentinel - Microservice Mesh Topology
 * Simulated Resilient Microservice Cluster with Sidecar Proxies
 * 
 * Author: 🏛️ أ. طارق ابوعشي
 */

import { CircuitBreaker } from '../resilience/circuit-breaker.js';
import { FaultInjector, FaultType } from '../chaos/fault-injector.js';
import { DistributedTracer } from '../observability/tracer.js';

export class ServiceMesh {
  constructor(options = {}) {
    this.tracer = options.tracer || new DistributedTracer();
    this.faultInjector = options.faultInjector || new FaultInjector();

    // Circuit breakers for downstream dependencies
    this.breakers = {
      'inventory-service': new CircuitBreaker('inventory-service', { failureThreshold: 3, recoveryTimeoutMs: 1200 }),
      'payment-service': new CircuitBreaker('payment-service', { failureThreshold: 3, recoveryTimeoutMs: 1500 }),
      'fraud-service': new CircuitBreaker('fraud-service', { failureThreshold: 2, recoveryTimeoutMs: 1000 })
    };

    // Internal inventory state
    this.inventory = {
      'item-101': { name: 'Quantum Processor QX-1', stock: 50 },
      'item-202': { name: 'Neural Accelerator Core', stock: 25 }
    };
  }

  getCircuitBreaker(serviceName) {
    return this.breakers[serviceName];
  }

  /**
   * Gateway entrypoint: Coordinates distributed checkout transaction
   */
  async handleCheckoutRequest(orderPayload) {
    const rootSpan = this.tracer.startTrace('POST /api/v1/checkout', 'api-gateway', {
      'order.id': orderPayload.orderId,
      'order.amount': orderPayload.amount,
      'client.ip': orderPayload.clientIp || '192.168.1.100'
    });

    try {
      // 1. Forward from Gateway to Order Service
      const orderResult = await this._callOrderService(rootSpan, orderPayload);
      rootSpan.setStatus('OK');
      rootSpan.end();
      this.tracer.recordSpan(rootSpan);

      return {
        success: true,
        orderId: orderPayload.orderId,
        traceId: rootSpan.traceId,
        details: orderResult
      };
    } catch (err) {
      rootSpan.setStatus('ERROR', err.message);
      rootSpan.end();
      this.tracer.recordSpan(rootSpan);

      return {
        success: false,
        orderId: orderPayload.orderId,
        traceId: rootSpan.traceId,
        error: err.message
      };
    }
  }

  async _callOrderService(parentSpan, orderPayload) {
    const span = this.tracer.startSpan('OrderService::ProcessOrder', 'order-service', parentSpan);

    try {
      await this.faultInjector.intercept('order-service');

      // Step A: Fraud Detection Check
      const fraudCheck = await this._callFraudService(span, orderPayload);

      // Step B: Reserve Inventory
      const inventoryResult = await this._callInventoryService(span, orderPayload.itemId, orderPayload.quantity || 1);

      // Step C: Process Payment
      const paymentResult = await this._callPaymentService(span, orderPayload.amount);

      span.setStatus('OK');
      span.end();
      this.tracer.recordSpan(span);

      return {
        status: 'CONFIRMED',
        fraudScore: fraudCheck.score,
        inventory: inventoryResult,
        payment: paymentResult
      };
    } catch (err) {
      span.setStatus('ERROR', err.message);
      span.end();
      this.tracer.recordSpan(span);
      throw err;
    }
  }

  async _callFraudService(parentSpan, orderPayload) {
    const span = this.tracer.startSpan('FraudService::AssessRisk', 'fraud-service', parentSpan);
    const breaker = this.breakers['fraud-service'];

    try {
      const result = await breaker.execute(async () => {
        await this.faultInjector.intercept('fraud-service');
        // Simulated fraud calculation
        return { score: 0.12, passed: true };
      }, (fallbackError) => {
        // Fallback: Degraded mode allows low-risk transactions through
        span.addEvent('DegradedModeFallback', { reason: fallbackError.message });
        return { score: 0.5, passed: true, degraded: true };
      });

      span.setStatus('OK');
      span.end();
      this.tracer.recordSpan(span);
      return result;
    } catch (err) {
      span.setStatus('ERROR', err.message);
      span.end();
      this.tracer.recordSpan(span);
      throw err;
    }
  }

  async _callInventoryService(parentSpan, itemId, quantity) {
    const span = this.tracer.startSpan('InventoryService::ReserveItem', 'inventory-service', parentSpan, {
      'item.id': itemId,
      'quantity': quantity
    });
    const breaker = this.breakers['inventory-service'];

    try {
      const result = await breaker.execute(async () => {
        await this.faultInjector.intercept('inventory-service');
        const item = this.inventory[itemId];
        if (!item) {
          throw new Error(`Item ${itemId} not found`);
        }
        if (item.stock < quantity) {
          throw new Error(`Insufficient inventory for ${itemId}`);
        }
        item.stock -= quantity;
        return { reserved: true, remaining: item.stock };
      });

      span.setStatus('OK');
      span.end();
      this.tracer.recordSpan(span);
      return result;
    } catch (err) {
      span.setStatus('ERROR', err.message);
      span.end();
      this.tracer.recordSpan(span);
      throw err;
    }
  }

  async _callPaymentService(parentSpan, amount) {
    const span = this.tracer.startSpan('PaymentService::ChargeCustomer', 'payment-service', parentSpan, {
      'charge.amount': amount
    });
    const breaker = this.breakers['payment-service'];

    try {
      const result = await breaker.execute(async () => {
        await this.faultInjector.intercept('payment-service');
        return { transactionRef: `TXN-${Date.now()}`, status: 'CHARGED' };
      });

      span.setStatus('OK');
      span.end();
      this.tracer.recordSpan(span);
      return result;
    } catch (err) {
      span.setStatus('ERROR', err.message);
      span.end();
      this.tracer.recordSpan(span);
      throw err;
    }
  }

  getTopologyMetrics() {
    return {
      inventory: this.breakers['inventory-service'].getMetrics(),
      payment: this.breakers['payment-service'].getMetrics(),
      fraud: this.breakers['fraud-service'].getMetrics(),
      chaosHistory: this.faultInjector.getHistory(),
      traceCount: this.tracer.getAllTraces().length
    };
  }
}
