import { ArrowUpRightIcon, CheckIcon } from "lucide-react";
import { buildDesignPreviewStyle, designPreviewName } from "@/lib/design-preview";
import { cn } from "@/lib/utils";

export function DesignThumbnail({ meta = {}, compact = false, className }) {
  return (
    <div
      className={cn("design-thumbnail", compact && "is-compact", className)}
      style={buildDesignPreviewStyle(meta)}
      aria-hidden="true"
    >
      <div className="design-thumbnail-rail"><span /><span /><span /></div>
      <div className="design-thumbnail-canvas">
        <span className="design-thumbnail-kicker" />
        <span className="design-thumbnail-title" />
        <span className="design-thumbnail-copy" />
        <div className="design-thumbnail-actions"><span /><span /></div>
        <div className="design-thumbnail-grid"><span /><span /></div>
      </div>
    </div>
  );
}

export function DesignSpecimen({ meta, label }) {
  const style = buildDesignPreviewStyle(meta);
  const name = designPreviewName(meta, label);

  return (
    <div className="design-specimen" style={style}>
      <header className="design-specimen-nav">
        <strong>{name}</strong>
        <nav aria-label="样张导航">
          <a href="#design-overview">Overview</a>
          <a href="#design-details">Details</a>
        </nav>
        <button type="button">Get started</button>
      </header>

      <main className="design-specimen-main">
        <section className="design-specimen-hero" id="design-overview">
          <div className="design-specimen-copy">
            <span className="design-specimen-label">Design direction</span>
            <h2>A clear system for focused products.</h2>
            <p>
              Typography, color, spacing, and components share one visual rhythm across every interaction.
            </p>
            <div className="design-specimen-actions">
              <button type="button">Start building</button>
              <a href="#design-details">Read principles <ArrowUpRightIcon aria-hidden="true" /></a>
            </div>
          </div>

          <div className="design-specimen-feature" id="design-details">
            <div className="design-specimen-feature-head">
              <span>System status</span>
              <strong>Ready</strong>
            </div>
            <div className="design-specimen-metric">
              <span>Visual consistency</span>
              <strong>High</strong>
            </div>
            <ul>
              <li><CheckIcon aria-hidden="true" /> Semantic color roles</li>
              <li><CheckIcon aria-hidden="true" /> Responsive type scale</li>
              <li><CheckIcon aria-hidden="true" /> Deliberate surface hierarchy</li>
            </ul>
          </div>
        </section>

        <section className="design-specimen-strip" aria-label="设计 token 摘要">
          <div><span>Primary</span><strong>{meta?.colors?.primary || "Default"}</strong></div>
          <div><span>Radius</span><strong>{meta?.radius?.md || "Default"}</strong></div>
          <div><span>Base type</span><strong>{meta?.typography?.scale?.body || "16px"}</strong></div>
        </section>
      </main>
    </div>
  );
}

export function DesignCode({ content }) {
  return (
    <div className="design-code-shell">
      <pre className="design-code"><code>{content}</code></pre>
    </div>
  );
}
