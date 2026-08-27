/*
 * IBCS SUCCESS — shared rule registry.
 * Single source of truth for all IBCS-Trainer mini-games (platformer, swipe,
 * escape room). Exposes window.IBCS with the full master Do/Don't rule set:
 *   STAGES, RULES (98), SUBSTAGES (35), RULE_COUNT and helper functions.
 */
(function (global) {
  'use strict';
// ===== IBCS SUCCESS — STAGES / SUBSTAGES / RULES =====
// The complete IBCS rule set (master Do/Don't table) drives the game. Every
// sub-rule is its own level. 7 stages (SUCCESS pillars) x 5 substages (rule
// groups) x 2-5 rules = 98 rule-levels, then a final boss + ISO 24896 room.
// Each rule tuple: [code, title, DO, DON'T] (+ optional {e,g} art override).
// art: e = "Don't" chart-monster to STOMP; g = "Do" chart to COLLECT.
const STAGES = [
  {pillar:'SIMPLIFY', area:'Notation', world:'The Cluttered Office', color:'#c0c8d0', theme:'meadow', form:'sparky',
   art:{e:'clutter', g:'clean'}, subs:[
    {code:'SI 1', title:'Avoid unnecessary elements', rules:[
      ['SI 1.1','Avoid cluttered layouts','Remove anything that carries no information','Crowd the page with meaningless elements'],
      ['SI 1.2','Avoid colored or filled backgrounds','Use a plain white background','Fill backgrounds with color or gradients'],
      ['SI 1.3','Avoid animation and transition effects','Keep visuals static','Add movement that distracts from data'],
    ]},
    {code:'SI 2', title:'Avoid decorative styles', rules:[
      ['SI 2.1','Avoid frames, shades, and 3D without meaning','Use flat 2D shapes','Add drop shadows, 3D, or borders for looks'],
      ['SI 2.2','Avoid decorative colors','Use color only to carry meaning','Use color as decoration'],
      ['SI 2.3','Avoid decorative fonts','Use one neutral, legible typeface','Use decorative or mixed fonts'],
    ]},
    {code:'SI 3', title:'Replace with cleaner layout', rules:[
      ['SI 3.1','Replace grid lines and value axes with data labels','Label data directly','Keep gridlines/axes when labels suffice',{e:'axisBreak',g:'clean'}],
      ['SI 3.2','Avoid vertical lines by right-aligning data','Right-align numbers in tables','Add vertical separator lines'],
    ]},
    {code:'SI 4', title:'Avoid redundancies', rules:[
      ['SI 4.1','Avoid superfluous words','Cut filler words in titles/labels','Pad text with unnecessary words'],
      ['SI 4.2','Avoid obvious terms','Drop words the reader already infers','State the obvious'],
      ['SI 4.3','Avoid repeated terms','Say it once (legend or axis)','Repeat the same term in legend and axis'],
    ]},
    {code:'SI 5', title:'Avoid distracting details', rules:[
      ['SI 5.1','Avoid labels for small values','Label only values that matter','Label values too small to matter'],
      ['SI 5.2','Avoid long numbers','Round/rescale (kEUR, mEUR)','Show overly long numbers',{e:'bigNumber',g:'clean'}],
      ['SI 5.3','Avoid unnecessary labels','Label only what supports the message','Label everything'],
    ]},
  ]},
  {pillar:'UNIFY', area:'Notation', world:'The Tower of Babel', color:'#3b6fe2', theme:'forest', form:'foxy',
   art:{e:'barDark', g:'barLight'}, subs:[
    {code:'UN 1', title:'Unify terminology', rules:[
      ['UN 1.1','Unify terms and abbreviations','Use the same word for a concept everywhere','Mix synonyms or abbreviations'],
      ['UN 1.2','Unify numbers, units, and dates','Use one format for numbers, units, dates','Mix number/unit/date formats'],
    ]},
    {code:'UN 2', title:'Unify text elements', rules:[
      ['UN 2.1','Unify key messages','Use a consistent style for headline messages','Style key messages differently each time'],
      ['UN 2.2','Unify titles and subtitles','Use the same title structure everywhere','Vary title structure'],
      ['UN 2.3','Unify the position of legends and labels','Place legends/labels in the same spot','Move legends around'],
    ]},
    {code:'UN 3', title:'Unify dimensions', rules:[
      ['UN 3.1','Unify measures','Use the same look for the same measure','Render the same measure differently'],
      ['UN 3.2','Unify scenarios','Standard fills: AC solid, PY light, PL outline, FC hatched','Invent scenario fills',{e:'barSolid',g:'barHatched'}],
      ['UN 3.3','Unify time periods, use horizontal axes','Run time left-to-right on the horizontal axis','Put time on the vertical axis'],
      ['UN 3.4','Unify structure dimensions, use vertical axes','Run structures top-down on a vertical axis','Put structures on the horizontal axis'],
    ]},
    {code:'UN 4', title:'Unify analyses', rules:[
      ['UN 4.1','Unify scenario analyses','Use standard variance notation (dPY, dPL, %)','Use ad-hoc variance marks',{e:'bigNumber',g:'deviation'}],
      ['UN 4.2','Unify time series analyses','Use standard time-series symbols','Invent time-series symbols'],
    ]},
    {code:'UN 5', title:'Unify markers', rules:[
      ['UN 5.1','Unify highlighting markers','Use standard highlight/trend/reference marks','Use random highlight marks'],
      ['UN 5.2','Unify scaling markers','Use standard marks when scales change','Hide scale changes'],
      ['UN 5.3','Unify outlier markers','Use standard triangle marks for outliers','Clip outliers without marking'],
    ]},
  ]},
  {pillar:'CHECK', area:'Notation', world:'The Hall of Mirrors', color:'#e23b3b', theme:'sky', form:'skyguard',
   art:{e:'axisBreak', g:'axisFull'}, subs:[
    {code:'CH 1', title:'Avoid manipulated axes', rules:[
      ['CH 1.1','Avoid truncated axes','Start value axes at zero','Truncate the value axis'],
      ['CH 1.2','Avoid logarithmic axes','Use linear scales','Use log axes that distort comparisons'],
      ['CH 1.3','Avoid different class sizes','Use equal class widths in distributions','Mix class sizes'],
    ]},
    {code:'CH 2', title:'Avoid manipulated visual components', rules:[
      ['CH 2.1','Avoid clipped visual components','Show full bars/columns','Cut bars to fit'],
      ['CH 2.2','Use creative solutions for scaling issues','Handle extremes with overlap/outlier indicators','Distort visuals to fit extremes'],
    ]},
    {code:'CH 3', title:'Avoid misleading representations', rules:[
      ['CH 3.1','Use correct area comparisons','Scale area honestly; prefer bars','Mis-scale areas',{e:'pie',g:'column'}],
      ['CH 3.2','Use correct volume comparisons','Prefer linear (1D) comparisons','Scale 3D volume to a 1D value'],
      ['CH 3.3','Avoid misleading colored areas in maps','Pair map color with size','Equate map color with magnitude'],
    ]},
    {code:'CH 4', title:'Use the same scales', rules:[
      ['CH 4.1','Use identical scale for the same unit','Use the same mm-per-unit across charts','Change scale for the same unit'],
      ['CH 4.2','Size charts to given data','Fit the chart frame to the data range','Pad frames arbitrarily'],
      ['CH 4.3','Use scaling indicators if necessary','Mark where a shared scale is broken','Break a scale silently'],
      ['CH 4.4','Use outlier indicators if necessary','Flag values exceeding the frame','Let outliers distort the frame unmarked'],
    ]},
    {code:'CH 5', title:'Show data adjustments', rules:[
      ['CH 5.1','Show the impact of inflation','Reveal real vs nominal','Show nominal only when inflation matters'],
      ['CH 5.2','Show the currency impact','Reveal currency-adjusted figures','Hide currency effects'],
    ]},
  ]},
  {pillar:'CONDENSE', area:'Composition', world:'The Cramped Warehouse', color:'#37a76a', theme:'cave', form:'batling',
   art:{e:'bigNumber', g:'deviation'}, subs:[
    {code:'CO 1', title:'Use small elements', rules:[
      ['CO 1.1','Use small fonts','Use smaller type to fit more content','Oversize fonts'],
      ['CO 1.2','Use small components','Use compact chart elements','Bloat components'],
      ['CO 1.3','Use small visuals','Prefer many small charts','Use one huge chart'],
    ]},
    {code:'CO 2', title:'Maximize use of space', rules:[
      ['CO 2.1','Use narrow page margins','Reclaim the margins','Waste page edges'],
      ['CO 2.2','Reduce empty space','Tighten gaps in visuals/tables','Leave large empty gaps'],
    ]},
    {code:'CO 3', title:'Add data', rules:[
      ['CO 3.1','Show data','Add data points that add insight','Omit informative data',{e:'clutter',g:'clean'}],
      ['CO 3.2','Show details','Add the supporting detail level','Hide useful detail'],
    ]},
    {code:'CO 4', title:'Add elements', rules:[
      ['CO 4.1','Show overlay charts','Layer related series (line over column)','Separate naturally-overlaid series',{e:'barSolid',g:'line'}],
      ['CO 4.2','Show multi-tier charts','Stack tiers of related measures','Split related tiers'],
      ['CO 4.3','Show extended charts','Add benchmarks / reference rows','Drop useful references'],
      ['CO 4.4','Embed chart components in tables','Add sparkline-style bars in tables','Keep tables purely numeric when bars help'],
      ['CO 4.5','Embed explanations','Add inline comments next to data','Separate explanations from data'],
    ]},
    {code:'CO 5', title:'Add visuals', rules:[
      ['CO 5.1','Show small multiples','Use a grid of comparable mini-charts','Merge incomparable series'],
      ['CO 5.2','Show related charts on one page','Group linked charts together','Scatter related charts'],
    ]},
  ]},
  {pillar:'EXPRESS', area:'Composition', world:'The Chart Zoo', color:'#e2a93b', theme:'volcano', form:'flameling',
   art:{e:'pie', g:'column'}, subs:[
    {code:'EX 1', title:'Use appropriate visuals', rules:[
      ['EX 1.1','Use appropriate chart types','Match chart to message','Pick the wrong chart type',{e:'funnel',g:'column'}],
      ['EX 1.2','Use appropriate table types','Use time / variance / cross tables as fit','Misuse table types'],
    ]},
    {code:'EX 2', title:'Replace inappropriate chart types', rules:[
      ['EX 2.1','Replace pie and ring charts','Use bars / columns','Use pie / ring charts',{e:'ring',g:'column'}],
      ['EX 2.2','Replace gauges, speedometers','Use bars with reference lines','Use gauges / speedometers',{e:'gauge',g:'column'}],
      ['EX 2.3','Replace radar and funnel charts','Use bar charts','Use radar / funnel charts',{e:'radar',g:'column'}],
      ['EX 2.4','Replace spaghetti charts','Use small multiples / highlighted line','Overplot many lines',{e:'spaghetti',g:'smallMultiples'}],
      ['EX 2.5','Replace traffic lights','Use signed values + variance bars','Use traffic-light symbols',{e:'traffic',g:'deviation'}],
    ]},
    {code:'EX 3', title:'Replace inappropriate representations', rules:[
      ['EX 3.1','Prefer quantitative representations','Use numbers over icons / symbols','Replace numbers with icons'],
      ['EX 3.2','Avoid text slides in presentations','Show data, not bullet text','Read bullet slides'],
    ]},
    {code:'EX 4', title:'Add comparisons', rules:[
      ['EX 4.1','Add scenarios','Compare AC vs PY vs PL vs FC','Show a single scenario alone',{e:'barSolid',g:'barLight'}],
      ['EX 4.2','Add variances','Show absolute + relative variance','Omit variances',{e:'bigNumber',g:'deviation'}],
    ]},
    {code:'EX 5', title:'Explain causes', rules:[
      ['EX 5.1','Show tree structures','Decompose totals (profit = sales - costs)','Leave totals unexplained',{e:'bigNumber',g:'meceGood'}],
      ['EX 5.2','Show clusters','Reveal groupings in scatter data','Ignore clustering'],
      ['EX 5.3','Show correlations','Pair sorted bars to expose relationships','Hide correlations'],
    ]},
  ]},
  {pillar:'STRUCTURE', area:'Composition', world:"The Architect's Blueprint", color:'#8e5bd0', theme:'ocean', form:'shellbit',
   art:{e:'meceBad', g:'meceGood'}, subs:[
    {code:'ST 1', title:'Use consistent elements', rules:[
      ['ST 1.1','Use consistent items','Use the same items in the same order','Reorder/omit items between visuals'],
      ['ST 1.2','Use consistent types of statements','Use parallel grammar (all verbs/all nouns)','Mix statement types'],
      ['ST 1.3','Use consistent wording','Use the same wording for the same thing','Vary wording'],
      ['ST 1.4','Use consistent visualizations','Use the same visual for the same concept','Change visuals for one concept'],
    ]},
    {code:'ST 2', title:'Build non-overlapping elements (ME)', rules:[
      ['ST 2.1','Build non-overlapping report structures','Keep each item in one bucket','Let an item appear in two buckets'],
      ['ST 2.2','Build non-overlapping business measures','Keep calculation steps disjoint','Double-count'],
      ['ST 2.3','Build non-overlapping structure dimensions','Use clean, disjoint groupings','Overlap dimensions'],
    ]},
    {code:'ST 3', title:'Build collectively exhaustive elements (CE)', rules:[
      ['ST 3.1','Build exhaustive arguments','Cover all options','Leave gaps in arguments'],
      ['ST 3.2','Build exhaustive structures','Add "Rest"/"Other" so parts sum to the whole','Omit the remainder'],
    ]},
    {code:'ST 4', title:'Build hierarchical structures', rules:[
      ['ST 4.1','Use deductive reasoning','Statement -> comment -> conclusion -> message','Bury the deduction'],
      ['ST 4.2','Use inductive reasoning','Synthesize many statements into one message','Leave statements unsynthesized'],
    ]},
    {code:'ST 5', title:'Visualize structure', rules:[
      ['ST 5.1','Visualize structure in reports','Use indentation/emphasis to show hierarchy','Flatten the hierarchy'],
      ['ST 5.2','Visualize structure in tables','Bold sums, indent members','Render tables flat'],
      ['ST 5.3','Visualize structure in notes','Use numbered, hierarchical note lists','Leave notes unstructured'],
    ]},
  ]},
  {pillar:'SAY', area:'Composition', world:'The Boardroom', color:'#ffd700', theme:'volcano', form:'infernox',
   art:{e:'barDark', g:'deviation'}, subs:[
    {code:'SA 1', title:'Know objectives', rules:[
      ['SA 1.1','Know own goals','Be clear on what you want to achieve','Start without a goal'],
      ['SA 1.2','Know target audience','Tailor to the reader/listener','Ignore the audience'],
    ]},
    {code:'SA 2', title:'Introduce message', rules:[
      ['SA 2.1','Map situation','State the agreed starting situation','Skip the setup'],
      ['SA 2.2','Explain problem','Name the complication / gap','Hide the problem'],
      ['SA 2.3','Raise question','Pose the question the message answers','Leave the question implicit'],
    ]},
    {code:'SA 3', title:'Deliver message', rules:[
      ['SA 3.1','Detect, explain, or suggest','Observation -> cause -> recommendation','Stop at observation'],
      ['SA 3.2','Say message first','Lead with the conclusion (top-down)','Bury the conclusion'],
    ]},
    {code:'SA 4', title:'Support message', rules:[
      ['SA 4.1','Provide evidence','Back claims with data','Make unsupported claims'],
      ['SA 4.2','Use precise words','Say "Cut of 3.5 mEUR"','Say "significant" vaguely'],
      ['SA 4.3','Highlight message','Visually mark the point in the chart','Leave the message unmarked'],
      ['SA 4.4','Name sources','Cite where the data came from','Omit sources'],
      ['SA 4.5','Link comments','Use numbered annotations tied to data','Float comments unlinked'],
    ]},
    {code:'SA 5', title:'Summarize message', rules:[
      ['SA 5.1','Repeat message','Restate the conclusion at the end','End without a recap'],
      ['SA 5.2','Explain consequences','Spell out next steps / decisions','Leave consequences unstated'],
    ]},
  ]},
];

// ----- Per-rule art overrides: give every one of the 98 rules its own
// distinct, easily-recognizable do/dont icon (e = enemy/"don't", g = collectible
// /"do"). Without this, every rule in a stage would inherit the stage default
// art, so a whole stage of levels looked identical. Glyph kinds are rendered by
// ibcs_charts.js. Within every stage all 14 enemy glyphs are unique. -----
const ARTMAP = {
  // SIMPLIFY
  'SI 1.1':{e:'clutter',g:'clean'},      'SI 1.2':{e:'bgFancy',g:'clean'},
  'SI 1.3':{e:'motion',g:'clean'},       'SI 2.1':{e:'bars3d',g:'column'},
  'SI 2.2':{e:'colorful',g:'mono'},      'SI 2.3':{e:'fontFancy',g:'fontPlain'},
  'SI 3.1':{e:'gridlines',g:'dataLabels'},'SI 3.2':{e:'tableGrid',g:'tableClean'},
  'SI 4.1':{e:'textLong',g:'textShort'}, 'SI 4.2':{e:'textObvious',g:'textShort'},
  'SI 4.3':{e:'textDup',g:'textOnce'},   'SI 5.1':{e:'labelAll',g:'labelKey'},
  'SI 5.2':{e:'bigNumber',g:'roundNumber'},'SI 5.3':{e:'overLabel',g:'labelFew'},
  // UNIFY
  'UN 1.1':{e:'mixTerms',g:'oneTerm'},   'UN 1.2':{e:'mixUnits',g:'oneUnit'},
  'UN 2.1':{e:'msgVaried',g:'msgUniform'},'UN 2.2':{e:'titleVaried',g:'titleUniform'},
  'UN 2.3':{e:'legendMoved',g:'legendFixed'},'UN 3.1':{e:'mixedViz',g:'sameViz'},
  'UN 3.2':{e:'mixedFills',g:'scenarioStd'},'UN 3.3':{e:'timeVert',g:'column'},
  'UN 3.4':{e:'structHoriz',g:'bar'},    'UN 4.1':{e:'varAdhoc',g:'deviation'},
  'UN 4.2':{e:'tsAdhoc',g:'tsStd'},      'UN 5.1':{e:'highlightRandom',g:'highlightStd'},
  'UN 5.2':{e:'scaleHidden',g:'scaleMark'},'UN 5.3':{e:'outlierNone',g:'outlierMark'},
  // CHECK
  'CH 1.1':{e:'axisBreak',g:'axisFull'}, 'CH 1.2':{e:'logAxis',g:'linAxis'},
  'CH 1.3':{e:'binsUneq',g:'binsEq'},    'CH 2.1':{e:'clipped',g:'column'},
  'CH 2.2':{e:'extremeRaw',g:'outlierMark'},'CH 3.1':{e:'pie',g:'column'},
  'CH 3.2':{e:'volume3d',g:'linear1d'},  'CH 3.3':{e:'mapColor',g:'mapSize'},
  'CH 4.1':{e:'diffScale',g:'sameScale'},'CH 4.2':{e:'wideMargin',g:'narrowMargin'},
  'CH 4.3':{e:'scaleHidden',g:'scaleMark'},'CH 4.4':{e:'outlierNone',g:'outlierMark'},
  'CH 5.1':{e:'nominalOnly',g:'realAdj'},'CH 5.2':{e:'currHidden',g:'currAdj'},
  // CONDENSE
  'CO 1.1':{e:'fontBig',g:'fontSmall'},  'CO 1.2':{e:'bloated',g:'compact'},
  'CO 1.3':{e:'oneHuge',g:'smallMultiples'},'CO 2.1':{e:'pageMargin',g:'pageFull'},
  'CO 2.2':{e:'emptyGaps',g:'tightChart'},'CO 3.1':{e:'dataSparse',g:'dataRich'},
  'CO 3.2':{e:'detailHidden',g:'detailShown'},'CO 4.1':{e:'seriesSplit',g:'overlay'},
  'CO 4.2':{e:'tierSplit',g:'multiTier'},'CO 4.3':{e:'benchNone',g:'benchmark'},
  'CO 4.4':{e:'numTable',g:'sparkTable'},'CO 4.5':{e:'noInline',g:'inlineNotes'},
  'CO 5.1':{e:'spaghetti',g:'smallMultiples'},'CO 5.2':{e:'scattered',g:'grouped'},
  // EXPRESS
  'EX 1.1':{e:'funnel',g:'column'},      'EX 1.2':{e:'tableWrong',g:'tableRight'},
  'EX 2.1':{e:'ring',g:'bar'},        'EX 2.2':{e:'gauge',g:'bar'},
  'EX 2.3':{e:'radar',g:'bar'},       'EX 2.4':{e:'spaghetti',g:'smallMultiples'},
  'EX 2.5':{e:'traffic',g:'deviation'},  'EX 3.1':{e:'iconQty',g:'numberQty'},
  'EX 3.2':{e:'textSlide',g:'dataSlide'},'EX 4.1':{e:'singleScenario',g:'scenarioStd'},
  'EX 4.2':{e:'bigNumber',g:'deviation'},'EX 5.1':{e:'oneHuge',g:'treeStruct'},
  'EX 5.2':{e:'clusterNone',g:'cluster'},'EX 5.3':{e:'corrNone',g:'correlation'},
  // STRUCTURE
  'ST 1.1':{e:'reordered',g:'ordered'},  'ST 1.2':{e:'parallelBad',g:'parallelGood'},
  'ST 1.3':{e:'mixTerms',g:'oneTerm'},   'ST 1.4':{e:'mixedViz',g:'sameViz'},
  'ST 2.1':{e:'meceBad',g:'meceGood'},   'ST 2.2':{e:'doubleCount',g:'waterfall'},
  'ST 2.3':{e:'overlapDim',g:'disjointDim'},'ST 3.1':{e:'gapArg',g:'fullArg'},
  'ST 3.2':{e:'gapStruct',g:'fullStruct'},'ST 4.1':{e:'buried',g:'deduction'},
  'ST 4.2':{e:'scatterStmt',g:'pyramidUp'},'ST 5.1':{e:'flatList',g:'indentList'},
  'ST 5.2':{e:'flatTable',g:'boldSums'}, 'ST 5.3':{e:'looseNotes',g:'numberedNotes'},
  // SAY
  'SA 1.1':{e:'noGoal',g:'target'},      'SA 1.2':{e:'noAudience',g:'audience'},
  'SA 2.1':{e:'noSetup',g:'situation'},  'SA 2.2':{e:'hideProblem',g:'problemGap'},
  'SA 2.3':{e:'noQuestion',g:'questionMark'},'SA 3.1':{e:'observeOnly',g:'recommend'},
  'SA 3.2':{e:'buried',g:'pyramidUp'},   'SA 4.1':{e:'claimOnly',g:'evidence'},
  'SA 4.2':{e:'vague',g:'precise'},      'SA 4.3':{e:'noEmphasis',g:'highlightStd'},
  'SA 4.4':{e:'noSource',g:'source'},    'SA 4.5':{e:'looseNotes',g:'linkedNotes'},
  'SA 5.1':{e:'noRecap',g:'recap'},      'SA 5.2':{e:'noNext',g:'nextSteps'},
};

// ----- Flatten the stage tree into a 1-based rule index (1..RULE_COUNT) -----
// Each entry: {lvl, stageIdx, subIdx, code, title, do, dont, enemyKind, good,
//              pillar, area, sub, world}.
const RULES = [];
const SUBSTAGES = []; // flat list of substages with their first level number
STAGES.forEach((st, si) => {
  st.subs.forEach((sub, sj) => {
    const firstLvl = RULES.length + 1;
    SUBSTAGES.push({stageIdx:si, subIdx:sj, code:sub.code, title:sub.title,
      pillar:st.pillar, world:st.world, color:st.color, firstLvl});
    sub.rules.forEach(r => {
      const art = ARTMAP[r[0]] || r[4] || st.art;
      RULES.push({
        lvl: RULES.length + 1, stageIdx: si, subIdx: sj, subGlobal: SUBSTAGES.length - 1,
        code: r[0], title: r[1], do: r[2], dont: r[3],
        enemyKind: art.e, good: art.g,
        pillar: st.pillar, area: st.area, sub: sub.code, subTitle: sub.title, world: st.world,
        slogan: r[2] + '  —  not: ' + r[3],
      });
    });
  });
});
const RULE_COUNT = RULES.length; // 98
function ibcsRule(lvl){ return RULES[(clampLvl(lvl)-1)] || RULES[0]; }
function clampLvl(lvl){ return Math.max(1, Math.min(RULE_COUNT, lvl|0)); }
function stageOf(lvl){ return ibcsRule(lvl).stageIdx; }
function subGlobalOf(lvl){ return ibcsRule(lvl).subGlobal; }
// Last rule-level of a substage / stage?
function isSubEnd(lvl){ const r=ibcsRule(lvl); const n=ibcsRule(lvl+1); return lvl>=RULE_COUNT || n.subGlobal!==r.subGlobal; }
function isStageEnd(lvl){ const r=ibcsRule(lvl); const n=ibcsRule(lvl+1); return lvl>=RULE_COUNT || n.stageIdx!==r.stageIdx; }

// ----- Per-rule Do/Don't chart images (single source of truth) -----
// Derives the picture paths from a rule's `code` so the registry and the image
// bank (public/game/img/, see docs/IBCS-Rule-Image-Mapping.md) never diverge.
// `<CODE>` is the code with spaces and dots replaced by hyphens (SI 1.1 -> SI-1-1).
// `side` is 'do' (compliant chart to collect) or 'dont' (violation chart).
function imageCode(code){ return String(code).replace(/[ .]/g, '-'); }
// `variant` (optional) selects an alternate image set, e.g. 'icon' = bold,
// color-coded sprite icons under img/icon/{do,dont}/ for small in-game rendering.
function imagePath(code, side, variant){
  var sideDir = (side === 'dont' ? 'dont' : 'do');
  var base = variant ? ('img/' + variant + '/' + sideDir) : ('img/' + sideDir);
  return base + '/' + imageCode(code) + '.png';
}

  global.IBCS = {
    STAGES, RULES, SUBSTAGES, RULE_COUNT,
    ibcsRule, clampLvl, stageOf, subGlobalOf, isSubEnd, isStageEnd,
    imageCode, imagePath,
  };
})(typeof window !== 'undefined' ? window : globalThis);
