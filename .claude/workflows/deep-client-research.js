export const meta = {
  name: 'deep-client-research',
  description: 'Deep per-client onboarding research: market + competitors + winning ad strategy + Marcus optimisation playbook, synthesised into stored fields. Pass client facts via args.',
  phases: [
    { title: 'Research', detail: 'parallel: market/competitor, winning strategy, targeting/creative, optimisation playbook' },
    { title: 'Synthesise', detail: 'compose the winning strategy + Marcus operating manual' },
  ],
}

// args: { businessName, website, city, country, niche, dailyBudgetGbp, usps }
const c = args || {}
const client = {
  businessName: c.businessName || 'the client',
  website:      c.website || '',
  city:         c.city || 'their city',
  country:      c.country || 'United Kingdom',
  niche:        c.niche || 'home services',
  dailyBudgetGbp: c.dailyBudgetGbp || 50,
  usps:         c.usps || '(see website)',
}
const cap = `${client.businessName} — a ${client.niche} business in ${client.city}, ${client.country}. Website: ${client.website}. USPs: ${client.usps}. Starting Meta ads budget ~£${client.dailyBudgetGbp}/day.`
const note = `Ground every claim in real, current knowledge — use web search for the local market and competitors. Be specific and numeric. This feeds an autonomous Meta media-buyer agent ("Marcus") who will run this account, so precision matters.`

const MARKET = { type:'object', additionalProperties:false, required:['demandDrivers','seasonality','competitors','localCplEstimateGbp','homeownerIntent','sources'], properties:{
  demandDrivers:{type:'array',items:{type:'string'}}, seasonality:{type:'string'},
  competitors:{type:'array',items:{type:'object',additionalProperties:false,required:['name','angle'],properties:{name:{type:'string'},angle:{type:'string'},offer:{type:'string'}}}},
  localCplEstimateGbp:{type:'number'}, homeownerIntent:{type:'array',items:{type:'string'}}, sources:{type:'array',items:{type:'string'}} } }
const STRATEGY = { type:'object', additionalProperties:false, required:['primaryAngle','offer','whyItWins','creativeConcept','funnel','landingHeadline'], properties:{
  primaryAngle:{type:'string'}, offer:{type:'string'}, whyItWins:{type:'string'}, creativeConcept:{type:'string'}, funnel:{type:'string'}, landingHeadline:{type:'string'} } }
const TARGETING = { type:'object', additionalProperties:false, required:['geo','ageMin','ageMax','interestsBehaviours','exclusions','placements','budgetPlan','adSetStructure','creativeDirections'], properties:{
  geo:{type:'string'}, ageMin:{type:'number'}, ageMax:{type:'number'}, interestsBehaviours:{type:'array',items:{type:'string'}}, exclusions:{type:'array',items:{type:'string'}},
  placements:{type:'array',items:{type:'string'}}, budgetPlan:{type:'string'}, adSetStructure:{type:'string'}, creativeDirections:{type:'array',items:{type:'string'}} } }
const PLAYBOOK = { type:'object', additionalProperties:false, required:['targetBands','scaleRule','pauseRule','creativeRefreshRule','learningPhaseRule','leverPriority','seasonalPlaybook','escalationThresholds','weeklyCadence','whatToWatch'], properties:{
  targetBands:{type:'object',additionalProperties:false,required:['cplGbp','ctrPct','frequency','cpmGbp'],properties:{cplGbp:{type:'string'},ctrPct:{type:'string'},frequency:{type:'string'},cpmGbp:{type:'string'}}},
  scaleRule:{type:'string'}, pauseRule:{type:'string'}, creativeRefreshRule:{type:'string'}, learningPhaseRule:{type:'string'}, leverPriority:{type:'array',items:{type:'string'}},
  seasonalPlaybook:{type:'string'}, escalationThresholds:{type:'string'}, weeklyCadence:{type:'string'}, whatToWatch:{type:'array',items:{type:'string'}} } }

const [market, strategy, targeting, playbook] = await parallel([
  () => agent(`${note}\n\nResearch the LOCAL MARKET + COMPETITORS for: ${cap}\nUse web search for ${client.city} ${client.niche}: who advertises, offers/angles, demand drivers, seasonality, realistic local CPL. Return the schema.`, { label:'market', phase:'Research', schema: MARKET }),
  () => agent(`${note}\n\nDesign the WINNING AD STRATEGY for: ${cap}\nThe single best angle + offer + creative concept + funnel for THIS business in ${client.city}, leveraging its USPs. The funnel ends in an AI ("Sophie") calling each lead within 60s and booking. Return the schema.`, { label:'strategy', phase:'Research', schema: STRATEGY }),
  () => agent(`${note}\n\nDesign the META TARGETING + BUDGET + CREATIVE plan for: ${cap}\nPrecise geo (radius around ${client.city}), age, homeowner interests/behaviours, exclusions, placements, a budget ramp from £${client.dailyBudgetGbp}/day, ad-set structure, and 3 concrete creative briefs. Return the schema.`, { label:'targeting', phase:'Research', schema: TARGETING }),
  () => agent(`${note}\n\nWrite the MEDIA-BUYER OPTIMISATION PLAYBOOK for an autonomous agent running this ${client.niche} account in ${client.country}. Exact target bands (CPL, CTR, frequency, CPM); precise SCALE/PAUSE/CREATIVE-REFRESH/LEARNING-PHASE rules; levers in priority order; seasonal/weather scaling; escalation thresholds; weekly cadence; what to watch. Numeric + prescriptive. Return the schema.`, { label:'playbook', phase:'Research', schema: PLAYBOOK }),
])

const synthesis = await agent(
  `${note}\n\nSynthesise the four research outputs into final stored fields for ${client.businessName}.\n\nMARKET:\n${JSON.stringify(market)}\n\nSTRATEGY:\n${JSON.stringify(strategy)}\n\nTARGETING:\n${JSON.stringify(targeting)}\n\nPLAYBOOK:\n${JSON.stringify(playbook)}\n\nWrite: winningStrategy (decisive prose Marcus+Sophie act on), mediaBuyerPlaybook (numeric, prescriptive operating manual — bands + scale/pause/refresh/learning rules, lever priority, seasonal, escalation, cadence, what to watch), targeting (structured), localCplBenchmarkGbp, competitorSnapshot {count,notable[]}, marketSummary (3-4 sentences).`,
  { label:'synthesis', phase:'Synthesise', schema: { type:'object', additionalProperties:false, required:['winningStrategy','mediaBuyerPlaybook','targeting','localCplBenchmarkGbp','competitorSnapshot','marketSummary'], properties:{
    winningStrategy:{type:'string'}, mediaBuyerPlaybook:{type:'string'},
    targeting:{type:'object',additionalProperties:false,required:['ageMin','ageMax','radiusKm','placements','interestsBehaviours','exclusions'],properties:{ageMin:{type:'number'},ageMax:{type:'number'},radiusKm:{type:'number'},placements:{type:'array',items:{type:'string'}},interestsBehaviours:{type:'array',items:{type:'string'}},exclusions:{type:'array',items:{type:'string'}}}},
    localCplBenchmarkGbp:{type:'number'}, competitorSnapshot:{type:'object',additionalProperties:false,required:['count','notable'],properties:{count:{type:'number'},notable:{type:'array',items:{type:'string'}}}}, marketSummary:{type:'string'} } } },
)

return { client, market, strategy, targeting, playbook, synthesis }
