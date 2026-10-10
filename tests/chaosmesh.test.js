/**
 * Comprehensive Test Suite for ChaosMesh Sentinel Observability
 * Verifies Circuit Breaker FSM, Chaos Fault Injection, and Distributed Tracing
 * 
 * Author: 🏛️ أ. طارق ابوعشي
 */

import { strict as assert } from 'assert';
import { CircuitBreaker, CircuitState, CircuitBreakerOpenError } from '../src/resilience/circuit-breaker.js';
import { FaultInjector, FaultType } from '../src/chaos/fault-injector.js';
import { DistributedTracer } from '../src/observability/tracer.js';
import { ServiceMesh } from '../src/mesh/service-mesh.js';

async function runTests() {
  console.log('🧪 Starting ChaosMesh Sentinel Observability Test Suite...\n');

  // Test 1: Circuit Breaker FSM State Transitions
  console.log('▶ Test 1: Circuit Breaker FSM State Transitions...');
  const breaker = new CircuitBreaker('test-service', {
    failureThreshold: 2,
    recoveryTimeoutMs: 100,
    halfOpenSuccessThreshold: 2
  });

  assert.equal(breaker.getState(), CircuitState.CLOSED, 'Breaker should initially be CLOSED');

  // Induce 1 failure - should remain CLOSED
  try {
    await breaker.execute(async () => { throw new Error('Fault 1'); });
  } catch (e) { /* expected */ }
  assert.equal(breaker.getState(), CircuitState.CLOSED, 'Should remain CLOSED after 1 failure');

  // Induce 2nd failure - should trip to OPEN
  try {
    await breaker.execute(async () => { throw new Error('Fault 2'); });
  } catch (e) { /* expected */ }
  assert.equal(breaker.getState(), CircuitState.OPEN, 'Should transition to OPEN after 2 failures');

  // When OPEN, calls should fast-fail with CircuitBreakerOpenError
  let fastFailed = false;
  try {
    await breaker.execute(async () => { return 'OK'; });
  } catch (err) {
    if (err instanceof CircuitBreakerOpenError) fastFailed = true;
  }
  assert.equal(fastFailed, true, 'Should immediately fast-fail when OPEN');

  // Wait for recovery timeout (110ms)
  await new Promise(r => setTimeout(r, 110));
  assert.equal(breaker.getState(), CircuitState.HALF_OPEN, 'Should transition to HALF_OPEN after timeout');

  // Execute 2 successful probes in HALF_OPEN
  await breaker.execute(async () => 'probe 1');
  assert.equal(breaker.getState(), CircuitState.HALF_OPEN, 'Should remain HALF_OPEN after 1 success');
  await breaker.execute(async () => 'probe 2');
  assert.equal(breaker.getState(), CircuitState.CLOSED, 'Should close after reaching halfOpenSuccessThreshold');
  console.log('  ✔ Circuit Breaker FSM successfully verified (CLOSED -> OPEN -> HALF_OPEN -> CLOSED)');

  // Test 2: Fault Injector Latency and Blackhole
  console.log('\n▶ Test 2: Fault Injector Latency and Blackhole...');
  const injector = new FaultInjector();
  injector.setFaultRule('auth-service', {
    faultType: FaultType.LATENCY,
    latencyMs: 50,
    jitterMs: 10
  });

  const t0 = Date.now();
  const interceptRes = await injector.intercept('auth-service');
  const elapsed = Date.now() - t0;
  assert.equal(interceptRes.injected, true, 'Fault should be injected');
  assert.ok(elapsed >= 45, `Expected delay >= 45ms, got ${elapsed}ms`);

  // Blackhole test
  injector.setFaultRule('isolated-db', {
    faultType: FaultType.BLACKHOLE
  });
  let blackholeCaught = false;
  try {
    await injector.intercept('isolated-db');
  } catch (err) {
    if (err.message.includes('Blackhole Partition')) blackholeCaught = true;
  }
  assert.equal(blackholeCaught, true, 'Blackhole partition should drop and throw');
  console.log('  ✔ Fault Injector latency & blackhole partitioning verified');

  // Test 3: Distributed Tracing & W3C Hierarchy
  console.log('\n▶ Test 3: Distributed Tracing & Span Context Hierarchy...');
  const tracer = new DistributedTracer();
  const rootSpan = tracer.startTrace('GET /user', 'gateway');
  await new Promise(r => setTimeout(r, 20));

  const childSpan = tracer.startSpan('SELECT * FROM users', 'postgres-db', rootSpan);
  await new Promise(r => setTimeout(r, 15));
  childSpan.end();
  tracer.recordSpan(childSpan);

  rootSpan.end();
  tracer.recordSpan(rootSpan);

  const fullTrace = tracer.getTrace(rootSpan.traceId);
  assert.equal(fullTrace.length, 2, 'Trace must contain 2 spans');
  assert.equal(fullTrace[0].parentSpanId, null, 'Root span must have null parentSpanId');
  assert.equal(fullTrace[1].parentSpanId, rootSpan.spanId, 'Child span parentSpanId must match root spanId');
  assert.ok(fullTrace[0].durationMs >= 30, 'Root duration must be sum of child durations');
  console.log('  ✔ Distributed Tracer hierarchy and duration tracking verified');

  // Test 4: End-to-End Service Mesh Resilient Execution
  console.log('\n▶ Test 4: Service Mesh Distributed Checkout Transaction...');
  const mesh = new ServiceMesh();

  // Scenario A: Happy path checkout
  const orderA = { orderId: 'ORD-901', itemId: 'item-101', quantity: 2, amount: 250 };
  const resA = await mesh.handleCheckoutRequest(orderA);
  assert.equal(resA.success, true, 'Healthy checkout should succeed');
  assert.equal(resA.details.status, 'CONFIRMED');

  const traceA = mesh.tracer.getTrace(resA.traceId);
  assert.equal(traceA.length, 5, 'Trace should include Gateway, Order, Fraud, Inventory, and Payment spans');
  console.log('  ✔ Healthy transaction succeeded with complete 5-span distributed trace');

  // Scenario B: Trip Payment Breaker with Chaos Fault
  mesh.faultInjector.setFaultRule('payment-service', {
    faultType: FaultType.ERROR,
    errorRate: 1.0,
    errorMessage: 'Payment Gateway Connection Refused'
  });

  // Trip the breaker (threshold is 3)
  for (let i = 0; i < 3; i++) {
    await mesh.handleCheckoutRequest({ orderId: `ORD-FAIL-${i}`, itemId: 'item-101', quantity: 1, amount: 100 });
  }

  const paymentBreaker = mesh.getCircuitBreaker('payment-service');
  assert.equal(paymentBreaker.getState(), CircuitState.OPEN, 'Payment breaker must be OPEN after 3 failures');

  // Subsequent call should fast fail
  const fastFailRes = await mesh.handleCheckoutRequest({ orderId: 'ORD-FAST-FAIL', itemId: 'item-101', quantity: 1, amount: 100 });
  assert.equal(fastFailRes.success, false, 'Transaction must fail when payment breaker is OPEN');
  assert.ok(fastFailRes.error.includes('Circuit is OPEN'), 'Error must specify circuit is OPEN');
  console.log('  ✔ Circuit breaker tripped by chaos injection and protected the mesh');

  console.log('\n🎉 ALL 4 CHAOSMESH SENTINEL TEST SUITES PASSED 100%!');
}

runTests().catch(err => {
  console.error('\n❌ Test failure:', err);
  process.exit(1);
});
