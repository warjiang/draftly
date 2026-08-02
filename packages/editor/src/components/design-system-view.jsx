import { useMemo, useState } from "react";
import { CopyIcon, FileTextIcon, XIcon } from "lucide-react";
import { buildDesignPreviewStyle, designPreviewName } from "@/lib/design-preview";
import {
  designAntiPatterns,
  designComponentRules,
  designMotion,
  designRadiusScale,
  designShadowScale,
  designSpacingScale,
  designSummary,
  designTypeScale,
  groupDesignColors,
  parseDesignBody,
} from "@/lib/design-system";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

function Section({ id, title, description, children }) {
  return (
    <section className="design-system-section" aria-labelledby={`design-section-${id}`}>
      <header className="design-system-section-head">
        <h3 id={`design-section-${id}`}>{title}</h3>
        {description ? <p>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Swatch({ item, onCopy }) {
  return (
    <li className="design-swatch">
      <button
        type="button"
        className="design-swatch-chip"
        style={{ background: item.value, color: item.onColor }}
        title={`复制 ${item.value}`}
        onClick={() => onCopy(item.value)}
      >
        <span className="design-swatch-sample">Aa 示例文字</span>
        <span className="design-swatch-copy" aria-hidden="true"><CopyIcon /></span>
        <span className="sr-only">复制色值 {item.value}</span>
      </button>
      <div className="design-swatch-meta">
        <div className="design-swatch-name">
          <strong>{item.token}</strong>
          <code>{item.value.toLowerCase()}</code>
        </div>
        <p>{item.usage}</p>
        <span className={cn("design-swatch-contrast", `is-${item.contrast.tone}`)}>
          {item.contrast.level} · {item.contrast.ratio.toFixed(2)}:1 对{item.contrastAgainst}
        </span>
      </div>
    </li>
  );
}

function ComponentSpecimens({ meta }) {
  const cardRule = meta?.components?.Card || {};
  return (
    <div className="design-specimen-grid">
      <article className="design-specimen-cell">
        <h4>按钮</h4>
        <div className="design-demo-row">
          <button type="button" className="design-demo-button is-primary">主要操作</button>
          <button type="button" className="design-demo-button is-secondary">次要操作</button>
          <button type="button" className="design-demo-button is-ghost">文字按钮</button>
          <button type="button" className="design-demo-button is-danger">删除</button>
          <button type="button" className="design-demo-button is-primary" disabled>不可用</button>
        </div>
        <p className="design-demo-tokens">colors.primary · radius.md · motion.duration</p>
      </article>

      <article className="design-specimen-cell">
        <h4>表单</h4>
        <div className="design-demo-field">
          <label htmlFor="design-demo-input">工作区名称</label>
          <input id="design-demo-input" className="design-demo-input" defaultValue="harbor-docs" />
          <span className="design-demo-help">用于生成项目目录，创建后仍可修改。</span>
        </div>
        <div className="design-demo-field">
          <label htmlFor="design-demo-invalid">邮箱</label>
          <input id="design-demo-invalid" className="design-demo-input is-invalid" defaultValue="team@" aria-invalid="true" />
          <span className="design-demo-error">请填写完整的邮箱地址。</span>
        </div>
        <p className="design-demo-tokens">colors.border · colors.muted · radius.sm</p>
      </article>

      <article className="design-specimen-cell">
        <h4>标签</h4>
        <div className="design-demo-row">
          <span className="design-demo-badge is-solid">已发布</span>
          <span className="design-demo-badge is-soft">草稿</span>
          <span className="design-demo-badge is-outline">协作中</span>
          <span className="design-demo-badge is-danger">构建失败</span>
        </div>
        <p className="design-demo-tokens">colors.accent · radius.full · typography.scale.small</p>
      </article>

      <article className="design-specimen-cell design-specimen-cell-wide">
        <h4>卡片</h4>
        <div className="design-demo-card">
          <div className="design-demo-card-head">
            <strong>最新构建</strong>
            <span className="design-demo-badge is-soft">构建成功</span>
          </div>
          <p>#128 · main@9f3a2c1 · 24 分钟前。全部步骤在本机完成，产物未离开这台设备。</p>
          <div className="design-demo-card-foot">
            <button type="button" className="design-demo-button is-ghost">查看完整日志</button>
            <button type="button" className="design-demo-button is-primary">重新构建</button>
          </div>
        </div>
        <p className="design-demo-tokens">
          colors.surface · shadows.{cardRule.shadow === "none" ? "sm" : "md"} · radius.md
          {cardRule.border ? ` · border: ${cardRule.border}` : ""}
        </p>
      </article>

      <article className="design-specimen-cell design-specimen-cell-wide">
        <h4>提示</h4>
        <div className="design-demo-alert">
          <strong>版本已保存</strong>
          <span>回退会创建新版本，历史记录不会被删除。</span>
        </div>
        <div className="design-demo-alert is-danger">
          <strong>后台同步中断</strong>
          <span>检测到网络不可达。所有变更已保留在本地队列，恢复连接后继续推送。</span>
        </div>
        <p className="design-demo-tokens">colors.accent · colors.destructive · radius.sm</p>
      </article>
    </div>
  );
}

export function DesignSystemView({ meta, name, body, compact = false, onCopyValue }) {
  const [openSection, setOpenSection] = useState(null);

  const data = useMemo(() => {
    if (!meta || typeof meta !== "object") return null;
    return {
      style: buildDesignPreviewStyle(meta),
      title: designPreviewName(meta, name || "设计系统"),
      summary: designSummary(meta),
      colorGroups: groupDesignColors(meta),
      typeScale: designTypeScale(meta),
      spacing: designSpacingScale(meta),
      radius: designRadiusScale(meta),
      shadows: designShadowScale(meta),
      motion: designMotion(meta),
      componentRules: designComponentRules(meta),
      antiPatterns: designAntiPatterns(meta),
      sections: compact ? [] : parseDesignBody(body),
    };
  }, [body, compact, meta, name]);

  if (!data) {
    return (
      <div className="design-state">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileTextIcon /></EmptyMedia>
            <EmptyTitle>无法解析这份 DESIGN.md</EmptyTitle>
            <EmptyDescription>
              front matter 缺失或格式不符合规范，切换到「源码」可以查看原文并修正。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const copyValue = (value) => onCopyValue?.(value);

  return (
    <div className={cn("design-system-view", compact && "is-compact")} style={data.style}>
      <header className="design-system-overview">
        <div className="design-system-identity">
          {data.summary.primary ? (
            <span className="design-system-primary" style={{ background: data.summary.primary }} aria-hidden="true" />
          ) : null}
          <div className="min-w-0">
            <h2>{data.title}</h2>
            <p>{data.summary.fontFamily}</p>
          </div>
        </div>
        <dl className="design-system-counts">
          <div><dt>颜色</dt><dd>{data.summary.colorCount}</dd></div>
          <div><dt>字阶</dt><dd>{data.summary.typeCount}</dd></div>
          <div><dt>间距</dt><dd>{data.summary.spacingCount}</dd></div>
          <div><dt>圆角</dt><dd>{data.summary.radiusCount}</dd></div>
          <div><dt>阴影</dt><dd>{data.summary.shadowCount}</dd></div>
        </dl>
      </header>

      {data.colorGroups.length ? (
        <Section id="colors" title="颜色" description="每个色值的角色、用途与可读性判定。点击色块可复制。">
          <div className="design-color-groups">
            {data.colorGroups.map((group) => (
              <div className="design-color-group" key={group.id}>
                <div className="design-color-group-head">
                  <h4>{group.title}</h4>
                  <p>{group.description}</p>
                </div>
                <ul className="design-swatch-grid">
                  {group.items.map((item) => (
                    <Swatch key={item.token} item={item} onCopy={copyValue} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {data.typeScale.length ? (
        <Section id="type" title="字体" description={data.summary.fontFamily}>
          <ul className="design-type-list">
            {data.typeScale.map((entry) => (
              <li key={entry.token}>
                <span className="design-type-sample" style={{ fontSize: entry.size }}>{entry.sample}</span>
                <span className="design-type-meta">
                  <code>{entry.token}</code>
                  <span>{entry.label}</span>
                  <strong>{entry.size}</strong>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {data.spacing?.steps.length ? (
        <Section id="spacing" title="间距" description={data.spacing.unit ? `基础单位 ${data.spacing.unit}，所有留白取它的倍数。` : "间距刻度。"}>
          <ul className="design-spacing-list">
            {data.spacing.steps.map((step) => (
              <li key={step.value}>
                <span className="design-spacing-bar" style={{ width: `${Math.max(step.ratio * 100, 4)}%` }} />
                <strong>{step.value}</strong>
                {step.multiple !== null ? <span>{step.multiple}× unit</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {data.radius.length || data.shadows.length ? (
        <Section id="surface" title="圆角与阴影" description="控件层级与抬升关系。">
          <div className="design-surface-grid">
            {data.radius.map((entry) => (
              <div className="design-surface-cell" key={`radius-${entry.token}`}>
                <span className="design-radius-block" style={{ borderRadius: entry.value }} />
                <strong>radius.{entry.token}</strong>
                <code>{entry.value}</code>
                <p>{entry.usage}</p>
              </div>
            ))}
            {data.shadows.map((entry) => (
              <div className="design-surface-cell" key={`shadow-${entry.token}`}>
                <span className="design-shadow-block" style={{ boxShadow: entry.value }} />
                <strong>shadows.{entry.token}</strong>
                <code>{entry.value}</code>
                <p>{entry.usage}</p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {data.motion ? (
        <Section id="motion" title="动效" description="悬停下方方块可以感受这套时长与缓动。">
          <div className="design-motion-row">
            <button type="button" className="design-motion-demo">悬停试试</button>
            <div className="design-motion-meta">
              {data.motion.duration ? <span><code>duration</code><strong>{data.motion.duration}</strong></span> : null}
              {data.motion.easing ? <span><code>easing</code><strong>{data.motion.easing}</strong></span> : null}
            </div>
          </div>
        </Section>
      ) : null}

      <Section id="components" title="组件样式" description="用这套 token 实时渲染的组件案例，生成的项目会遵循同一套规则。">
        <ComponentSpecimens meta={meta} />
      </Section>

      {!compact && data.componentRules.length ? (
        <Section id="conventions" title="组件约定" description="DESIGN.md 对具体组件的硬性要求。">
          <div className="design-rule-grid">
            {data.componentRules.map((entry) => (
              <div className="design-rule-cell" key={entry.component}>
                <strong>{entry.component}</strong>
                <dl>
                  {entry.rules.map((rule) => (
                    <div key={rule.rule}>
                      <dt>{rule.label}</dt>
                      <dd>{rule.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {!compact && data.antiPatterns.length ? (
        <Section id="anti-patterns" title="反模式" description="生成时必须避开的做法。">
          <ul className="design-anti-list">
            {data.antiPatterns.map((item) => (
              <li key={item}><XIcon aria-hidden="true" /><code>{item}</code></li>
            ))}
          </ul>
        </Section>
      ) : null}

      {!compact && data.sections.length ? (
        <Section id="body" title="规范正文" description="DESIGN.md 中写给生成器的完整说明。">
          <div className="design-body-sections">
            {data.sections.map((section, index) => {
              const expanded = openSection === null ? index < 2 : openSection === index;
              return (
                <details
                  key={section.title}
                  className="design-body-section"
                  open={expanded}
                  onToggle={(event) => setOpenSection(event.currentTarget.open ? index : null)}
                >
                  <summary>{section.title}</summary>
                  {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  {section.items.length ? (
                    <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
                  ) : null}
                </details>
              );
            })}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
