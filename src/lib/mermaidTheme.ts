import type { MermaidConfig } from "mermaid";
import type { Mode } from "../store/useStore";

/**
 * Mermaid's `base` theme, fed the app's own palette so diagrams read as part of
 * the document rather than as a pasted-in picture: monochrome shapes on paper or
 * soot, hairline strokes, and the cobalt accent reserved for emphasis. The
 * annotation wash tones from themes.css double as the categorical scale (pie
 * slices, git branches, state colour scales).
 *
 * Keep these in step with src/styles/themes.css — the SVG is self-contained,
 * so it cannot read the CSS custom properties directly.
 */

interface Palette {
  bg: string;
  surface2: string;
  fg: string;
  muted: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentFg: string;
  /** Shape fill: a cobalt wash so nodes lift off the figure background. */
  fill: string;
  /** Categorical scale: ochre, sage, slate, dusk rose, heather, cobalt. */
  scale: string[];
}

const LIGHT: Palette = {
  bg: "#ffffff",
  surface2: "#f2f2ef",
  fg: "#161616",
  muted: "#757571",
  border: "#e4e4e0",
  borderStrong: "#161616",
  accent: "#2255d4",
  accentFg: "#ffffff",
  fill: "#e6edfc",
  scale: ["#e6b04f", "#6fb497", "#6f9ad6", "#df8197", "#a08fe0", "#6f93ec"],
};

const DARK: Palette = {
  bg: "#161615",
  surface2: "#1d1d1b",
  fg: "#e9e9e6",
  muted: "#8f8f8a",
  border: "#2b2b28",
  borderStrong: "#e9e9e6",
  accent: "#7da3f5",
  accentFg: "#0f0f0e",
  fill: "#1c2842",
  scale: ["#a87b22", "#3d8566", "#3f6fae", "#a8475e", "#6c58b0", "#3d63d6"],
};

const FONT =
  '"Hanken Grotesk Variable", "Hanken Grotesk", "Helvetica Neue", Helvetica, Arial, sans-serif';

export function mermaidConfig(mode: Mode): MermaidConfig {
  const p = mode === "dark" ? DARK : LIGHT;
  const [c0, c1, c2, c3, c4, c5] = p.scale;

  const themeVariables: Record<string, string | boolean | number> = {
    darkMode: mode === "dark",
    background: p.bg,
    fontFamily: FONT,
    fontSize: "14px",

    // Shapes: quiet fills, ink outlines, body text in the foreground colour.
    primaryColor: p.fill,
    primaryTextColor: p.fg,
    primaryBorderColor: p.borderStrong,
    secondaryColor: p.bg,
    secondaryTextColor: p.fg,
    secondaryBorderColor: p.borderStrong,
    tertiaryColor: p.surface2,
    tertiaryTextColor: p.fg,
    tertiaryBorderColor: p.border,
    mainBkg: p.fill,
    nodeBkg: p.fill,
    nodeBorder: p.borderStrong,
    nodeTextColor: p.fg,
    textColor: p.fg,
    titleColor: p.fg,
    lineColor: p.borderStrong,
    arrowheadColor: p.borderStrong,
    defaultLinkColor: p.borderStrong,
    edgeLabelBackground: p.bg,
    clusterBkg: p.surface2,
    clusterBorder: p.muted,

    // Notes: paper-on-paper, not post-it yellow.
    noteBkgColor: p.bg,
    noteBorderColor: p.muted,
    noteTextColor: p.fg,

    // Sequence diagrams.
    actorBkg: p.fill,
    actorBorder: p.borderStrong,
    actorTextColor: p.fg,
    actorLineColor: p.muted,
    signalColor: p.borderStrong,
    signalTextColor: p.fg,
    labelBoxBkgColor: p.fill,
    labelBoxBorderColor: p.borderStrong,
    labelTextColor: p.fg,
    loopTextColor: p.fg,
    activationBkgColor: p.accent,
    activationBorderColor: p.accent,
    sequenceNumberColor: p.accentFg,

    // State diagrams.
    labelColor: p.fg,
    stateBkg: p.fill,
    stateLabelColor: p.fg,
    transitionColor: p.borderStrong,
    transitionLabelColor: p.fg,
    altBackground: p.bg,
    compositeBackground: p.bg,
    compositeTitleBackground: p.fill,
    compositeBorder: p.border,
    innerEndBackground: p.borderStrong,
    specialStateColor: p.borderStrong,
    errorBkgColor: c3,
    errorTextColor: p.fg,

    // Class / ER / requirement diagrams.
    classText: p.fg,
    attributeBackgroundColorOdd: p.bg,
    attributeBackgroundColorEven: p.surface2,
    requirementBackground: p.fill,
    requirementBorderColor: p.borderStrong,
    requirementTextColor: p.fg,
    relationColor: p.borderStrong,
    relationLabelBackground: p.bg,
    relationLabelColor: p.fg,

    // Gantt: tasks are neutral blocks; the active and critical ones carry colour.
    sectionBkgColor: p.surface2,
    sectionBkgColor2: p.surface2,
    altSectionBkgColor: p.bg,
    excludeBkgColor: p.surface2,
    gridColor: p.border,
    todayLineColor: p.accent,
    taskBkgColor: p.fill,
    taskBorderColor: p.borderStrong,
    taskTextColor: p.fg,
    taskTextDarkColor: p.fg,
    taskTextLightColor: p.fg,
    taskTextOutsideColor: p.fg,
    taskTextClickableColor: p.accent,
    activeTaskBkgColor: p.accent,
    activeTaskBorderColor: p.accent,
    doneTaskBkgColor: p.border,
    doneTaskBorderColor: p.muted,
    critBkgColor: c3,
    critBorderColor: p.borderStrong,

    // Git graph.
    git0: c5, git1: c0, git2: c1, git3: c2, git4: c3, git5: c4, git6: p.muted, git7: p.border,
    gitBranchLabel0: p.fg, gitBranchLabel1: p.fg, gitBranchLabel2: p.fg, gitBranchLabel3: p.fg,
    gitBranchLabel4: p.fg, gitBranchLabel5: p.fg, gitBranchLabel6: p.bg, gitBranchLabel7: p.fg,
    commitLabelColor: p.fg,
    commitLabelBackground: p.surface2,
    tagLabelColor: p.fg,
    tagLabelBackground: p.bg,
    tagLabelBorder: p.borderStrong,

    // Pie, quadrant, and the generic colour scale.
    pie1: c5, pie2: c0, pie3: c1, pie4: c2, pie5: c3, pie6: c4,
    pie7: p.muted, pie8: p.border, pie9: c5, pie10: c0, pie11: c1, pie12: c2,
    pieTitleTextColor: p.fg,
    pieSectionTextColor: p.fg,
    pieLegendTextColor: p.fg,
    pieStrokeColor: p.bg,
    pieOuterStrokeColor: p.bg,
    cScale0: c5, cScale1: c0, cScale2: c1, cScale3: c2, cScale4: c3, cScale5: c4,
    cScale6: c5, cScale7: c0, cScale8: c1, cScale9: c2, cScale10: c3, cScale11: c4,
    scaleLabelColor: p.fg,
    quadrant1Fill: p.surface2,
    quadrant2Fill: p.bg,
    quadrant3Fill: p.surface2,
    quadrant4Fill: p.bg,
    quadrant1TextFill: p.fg,
    quadrant2TextFill: p.fg,
    quadrant3TextFill: p.fg,
    quadrant4TextFill: p.fg,
    quadrantPointFill: p.accent,
    quadrantPointTextFill: p.fg,
    quadrantXAxisTextFill: p.muted,
    quadrantYAxisTextFill: p.muted,
    quadrantInternalBorderStrokeFill: p.border,
    quadrantExternalBorderStrokeFill: p.borderStrong,
    quadrantTitleFill: p.fg,

    // Journey / mindmap / architecture.
    fillType0: c5, fillType1: c0, fillType2: c1, fillType3: c2,
    fillType4: c3, fillType5: c4, fillType6: p.muted, fillType7: p.border,
    personBkg: p.fill,
    personBorder: p.borderStrong,
    archEdgeColor: p.borderStrong,
    archEdgeArrowColor: p.borderStrong,
    archGroupBorderColor: p.border,
  };

  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables,
    fontFamily: FONT,
    // Firm outlines and edges, medium-weight labels: diagrams should read at a glance.
    themeCSS: `
      .node rect, .node circle, .node ellipse, .node polygon, .node path,
      .actor, .classGroup rect, .er.entityBox,
      g.stateGroup rect, .statediagram-state rect, .task { stroke-width: 1.5px; }
      .edgePath .path, .flowchart-link, .transition, .relation,
      .messageLine0, .messageLine1 { stroke-width: 1.75px; }
      .cluster rect { stroke-width: 1px; stroke-dasharray: 4 3; }
      .nodeLabel, .actor tspan, .stateLabel, .classTitle, .cluster-label { font-weight: 500; }
      .edgeLabel, .edgeLabel p { line-height: 1.3; }
    `,
  };
}
