import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export interface CourseForgeUiContext {
  ottoStatus: 'OK' | 'WAITING';
  courseForgeStatus: 'LOADED' | 'BOOTING';
  extensionStatus: {
    cli: 'OK' | 'WAITING';
    api: 'OK' | 'WAITING';
  };
  updateStatus: 'UPDATED' | 'UP-TO-DATE';
  observability: {
    logging: 'ON' | 'OFF';
    tracing: 'ON' | 'OFF';
    metrics: 'ON' | 'OFF';
  };
}

export interface SkeletonUiRenderResult {
  title: string;
  html: string;
  indicators: Array<{
    label: string;
    state: string;
  }>;
}

export function renderSkeletonUi(context: CourseForgeUiContext): SkeletonUiRenderResult {
  const indicators = [
    { label: 'Otto', state: context.ottoStatus },
    { label: 'CourseForge', state: context.courseForgeStatus },
    { label: 'CLI', state: context.extensionStatus.cli },
    { label: 'API', state: context.extensionStatus.api },
    { label: 'Updates', state: context.updateStatus },
    { label: 'Logging', state: context.observability.logging },
    { label: 'Tracing', state: context.observability.tracing },
    { label: 'Metrics', state: context.observability.metrics }
  ];

  const markup = renderToStaticMarkup(<SkeletonWindow indicators={indicators} />);
  return {
    title: 'CourseForge Skeleton',
    html: `<!doctype html><html><head><meta charset="utf-8"><title>CourseForge Skeleton</title></head><body>${markup}</body></html>`,
    indicators
  };
}

function SkeletonWindow({ indicators }: { indicators: Array<{ label: string; state: string }> }): React.JSX.Element {
  return (
    <main
      style={{
        minHeight: '100vh',
        margin: 0,
        background: 'radial-gradient(circle at top, #f2efe6, #d7dfd4 55%, #b9c5ba)',
        color: '#16211b',
        fontFamily: 'Georgia, "Times New Roman", serif',
        display: 'grid',
        placeItems: 'center',
        padding: '32px'
      }}
    >
      <section
        style={{
          width: 'min(760px, 100%)',
          background: 'rgba(251, 248, 240, 0.94)',
          border: '1px solid rgba(22, 33, 27, 0.14)',
          borderRadius: '28px',
          padding: '32px',
          boxShadow: '0 30px 70px rgba(39, 56, 45, 0.18)'
        }}
      >
        <p style={{ letterSpacing: '0.16em', textTransform: 'uppercase', fontSize: '12px', margin: '0 0 12px' }}>
          Tracer Bullet Deployment
        </p>
        <h1 style={{ fontSize: '42px', margin: '0 0 12px' }}>CourseForge Skeleton</h1>
        <p style={{ fontSize: '18px', lineHeight: 1.5, margin: '0 0 24px' }}>
          Otto is running in the background and the CourseForge shell has attached to the bootstrap lifecycle.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '14px'
          }}
        >
          {indicators.map((indicator) => (
            <article
              key={indicator.label}
              style={{
                background: '#f5f2e8',
                borderRadius: '18px',
                padding: '18px',
                border: '1px solid rgba(22, 33, 27, 0.1)'
              }}
            >
              <div style={{ fontSize: '12px', letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.72 }}>
                {indicator.label}
              </div>
              <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '10px' }}>{indicator.label}: {indicator.state}</div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}