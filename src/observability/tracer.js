/**
 * ChaosMesh Sentinel - Distributed Observability Engine
 * Distributed Tracer, Span Life Cycle & Trace Context Propagator
 * 
 * Author: 🏛️ أ. طارق ابوعشي
 */

import { randomBytes } from 'crypto';

export class Span {
  constructor({ traceId, spanId, parentSpanId = null, name, service, attributes = {} }) {
    this.traceId = traceId;
    this.spanId = spanId || randomBytes(8).toString('hex');
    this.parentSpanId = parentSpanId;
    this.name = name;
    this.service = service;
    this.startTime = Date.now();
    this.endTime = null;
    this.durationMs = 0;
    this.status = 'OK'; // OK or ERROR
    this.attributes = { ...attributes };
    this.events = [];
  }

  addEvent(name, attributes = {}) {
    this.events.push({
      name,
      timestamp: Date.now(),
      attributes
    });
  }

  setStatus(status, errorMessage = null) {
    this.status = status;
    if (errorMessage) {
      this.attributes['error.message'] = errorMessage;
    }
  }

  end() {
    this.endTime = Date.now();
    this.durationMs = Math.max(0, this.endTime - this.startTime);
    return this;
  }

  toJSON() {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      service: this.service,
      startTime: this.startTime,
      endTime: this.endTime,
      durationMs: this.durationMs,
      status: this.status,
      attributes: this.attributes,
      events: this.events
    };
  }
}

export class DistributedTracer {
  constructor() {
    this.traces = new Map(); // traceId -> Array<Span>
  }

  generateTraceId() {
    return randomBytes(16).toString('hex');
  }

  generateSpanId() {
    return randomBytes(8).toString('hex');
  }

  startTrace(name, service, initialAttributes = {}) {
    const traceId = this.generateTraceId();
    const rootSpan = new Span({
      traceId,
      spanId: this.generateSpanId(),
      parentSpanId: null,
      name,
      service,
      attributes: initialAttributes
    });

    this.traces.set(traceId, [rootSpan]);
    return rootSpan;
  }

  startSpan(name, service, parentSpan, attributes = {}) {
    if (!parentSpan) {
      return this.startTrace(name, service, attributes);
    }

    const span = new Span({
      traceId: parentSpan.traceId,
      spanId: this.generateSpanId(),
      parentSpanId: parentSpan.spanId,
      name,
      service,
      attributes
    });

    const spans = this.traces.get(parentSpan.traceId) || [];
    spans.push(span);
    this.traces.set(parentSpan.traceId, spans);

    return span;
  }

  recordSpan(span) {
    if (!span.endTime) {
      span.end();
    }
    const spans = this.traces.get(span.traceId) || [];
    if (!spans.some(s => s.spanId === span.spanId)) {
      spans.push(span);
      this.traces.set(span.traceId, spans);
    }
  }

  getTrace(traceId) {
    const spans = this.traces.get(traceId) || [];
    return spans.map(s => s.toJSON()).sort((a, b) => a.startTime - b.startTime);
  }

  getAllTraces() {
    const summary = [];
    for (const [traceId, spans] of this.traces.entries()) {
      const rootSpan = spans.find(s => !s.parentSpanId) || spans[0];
      const hasError = spans.some(s => s.status === 'ERROR');
      const totalDuration = spans.reduce((max, s) => {
        const spanEnd = s.endTime || Date.now();
        const rootStart = rootSpan ? rootSpan.startTime : s.startTime;
        return Math.max(max, spanEnd - rootStart);
      }, 0);

      summary.push({
        traceId,
        rootService: rootSpan ? rootSpan.service : 'unknown',
        rootName: rootSpan ? rootSpan.name : 'unknown',
        spanCount: spans.length,
        hasError,
        durationMs: totalDuration,
        startTime: rootSpan ? rootSpan.startTime : 0
      });
    }
    return summary.sort((a, b) => b.startTime - a.startTime);
  }

  clearTraces() {
    this.traces.clear();
  }
}
