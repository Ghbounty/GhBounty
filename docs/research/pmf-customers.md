# Research: PMF de GhBounty y clientes potenciales

> Fecha de research: 2026-05-15. Investigación basada en evidencia pública (Algora, GitHub, OpenCollective, blogs corporativos, HN). Las cifras son las publicadas en las páginas oficiales/perfiles en la fecha de acceso.

---

## TL;DR

- **Veredicto PMF: AMARILLO — con sesgo positivo.** Hay demanda real y comprobada de empresas pagando por issues resueltos, pero el mercado es nicho, los tamaños de bounty bajos ($50–$500 median), y ya existe un incumbente con tracción (Algora) más varios cementerios recientes (Replit Bounties cerró 9/2025, Polar.sh puso issue funding en mantenimiento, BountySource muerto).
- **La pregunta "¿pagarían?" tiene respuesta empírica: sí, en al menos 4 categorías.** Startups OSS-first (Twenty, Cal.com, Maybe, Coolify), proyectos OSS con foundations/sponsors (PX4, AsyncAPI, OBS), AI/dev-tool companies (Daytona, Activepieces, Browser Use, Comet/Opik), y empresas con bounty + matching programs (Stripe, Vercel, Sentry) — aunque las últimas pagan principalmente por seguridad, no por features.
- **El diferenciador real de GhBounty (evaluación AI verificable + agentes IA como solvers) NO está validado por demanda observable.** Lo que sí está validado es el sustrato: empresas pagan por PRs mergeados. La pregunta abierta es si pagarían **más** por pipeline automatizado/agentes vs. el modelo Algora actual.
- **Riesgo dominante: techo de mercado.** Los volúmenes públicos sugieren que el bounty marketplace global de "feature delivery" se mide en decenas de millones de USD anuales, no centenares. Algora a octubre 2023 reportaba acumulado de $65,785 / 600 bounties; en 2025 el top contributor llegó a $55k earned. Es un mercado real pero modesto.
- **Señal naranja: el modelo "competencia abierta entre solvers" tiene fricción documentada.** OBS deliberadamente diseñó su programa para evitar "races" entre devs; HN tiene threads críticos ("Bounties Damage Open Source Projects"). GhBounty necesita responder a esa fricción.

---

## Evidencia de demanda (¿hay PMF?)

### Plataformas vivas y volúmenes observados

| Plataforma | Estado 2026-05 | Métrica pública |
|---|---|---|
| **Algora** | Vivo, bootstrapped, sin VC | 848 contributors / 75 países; top earner $55,025; OBS data oct-2023: $65,785 en 600 bounties. Casos como Maybe Finance: $18,000 budget, 47 bounties + 14 tips, 58 completed |
| **Gitcoin** | Vivo, pivoteado a grants | Distribuyó >$38M vía quadratic funding en 4 años; Grants 2025: $4.29M para OSS. Bounties como mecanismo siguen activos pero pivot fuerte hacia grants |
| **IssueHunt** | Vivo, pivoteado a bug bounty (Japón) | Originalmente issue-based bounty, ahora "#1 bug bounty platform in Japan" |
| **OpenCollective bounties** | Vivo, modelo "fund the collective" | OBS Project: $85,822 raised, $9,948 disbursed; bounty sizes típicos $100–$1000 |
| **Polar.sh** | Issue funding en **maintenance mode** (deprecated por default) | Ellos mismos dijeron "no estamos muy interesados en esta feature, vamos a product selling" |
| **Replit Bounties** | **Cerrado** Sept 6, 2025 | Lanzó 2023 con bombos de Amjad Masad; murió 2 años después |
| **BountySource** | **Muerto** ("The site is temporarily down") | El veterano de la categoría, RIP |
| **BountyHub** | Lanzado Jun 2025, vivo | Nuevo entrante, Stripe-backed payments |
| **Opire** | Vivo, competidor directo de Algora | Comparado lado-a-lado en posts de DEV.to |

**Lectura:** la categoría tiene un graveyard considerable (BountySource, Replit, Polar pivot, IssueHunt pivot). Esto no es señal de "no hay mercado" — es señal de que **el modelo es difícil de operar rentablemente a escala consumer**. Algora sobrevive porque es bootstrapped y nicho.

### Casos públicos concretos de empresas pagando

Estos son casos donde existe evidencia pública (página Algora, GitHub issue, blog post) de que **alguien sí pagó por un PR mergeado**:

- **Twenty (YC S23)** — $2,500 bounty público para feature IMAP. [algora.io/twentyhq/home](https://algora.io/twentyhq/home)
- **Cal.com** — Programa "bounty-to-hire": pagan el bounty Y si te gusta el dev, lo contratan. Issue #21050 público (Outlook Cache). 86 contributors over 2+ years shipping 14 high-priority, 24 improvements, 21 bugs, 68 new features, 18 integrations.
- **Maybe Finance** — $18,000 budget total declarado, 58 bounties completados, top contributor $3,350. Founder Josh Pigford hizo video en YouTube explicando el modelo.
- **PX4 Autopilot (Dronecode/Linux Foundation)** — $1,000 bounty público, sponsoreado por Alex Klimaj (CEO ARK Electronics) + Andrew Wilkins (CEO Ascend Engineering) para reescribir collision prevention. Cubierto por UnmannedSystemsTechnology Dec 2024. Bounty fue resuelto por Claudio Chies.
- **Golem Cloud** — $10,000 total awarded, 738 bounties listadas. Página Algora pública.
- **Coolify** — $1,382 paid out, 26 bounties completadas, 16 solvers. Bounties típicas $10–$100.
- **Trigger.dev** — Bounty de $100/persona × 10 personas para video walkthroughs de onboarding.
- **Screenpipe** — Bounties de testing de $20 por reporte válido, múltiples winners aceptados.
- **AsyncAPI** — Programa quarterly: Q1 2025 $1,800/$5,000 budget; Q2 2025 $4,800/$5,000; Q3 2025 $3,000/$5,000. 94% success rate en Q2.
- **OBS Project** — Bounty Program lanzado 2021 vía OpenCollective: $85,822 raised, $9,948 disbursed. Bounties como VST3 Support, scene organization.
- **Daytona** — Pledged $60,000 a OSS en 2024, $1,375 awarded a 13 contributors en test inicial. 128 bounties completadas históricas.
- **Activepieces (YC)** — MCP Bounty Program: hasta $200 por integración construida; 10 active bounties = $1,250 totales en algún momento.
- **Comet / Opik** — Bounty Program activo (aunque "pausado" según docs) para LLM observability features, paga vía Algora.
- **Zama** — Bounty/Developer Program FHE: €10,000/mes en rewards, históricos €15,000 por challenge individual, >€500,000 acumulado prometido.
- **Hyperswitch (Juspay)** — Bounty público $2,000 para plugin Prestashop (issue #6000), programa formal con guidelines wiki.
- **Zed Industries** — $600 total awarded en 2 bounties; bounty $500 "Replace mode in Vim". GitHub cofounder Scott Chacon involucrado en sponsoring features.
- **com-lihaoyi (Scala)** — Lista de bounties $300–$2,000 mantenida públicamente, última actualización abril 2025.

### Programas "fund this issue" / matching programs no bounty-marketplace

- **Sentry** — Dio $260,028 a maintainers OSS en un año (2022). No "bounty per issue" pero sí compromiso financiero estructural.
- **ElevenLabs OSS Engineers Fund** — $22,000 cada 6 meses a OSS projects nominados por engineers internos. Lanzado nov 2025.
- **Vercel OSS Bug Bounty** — >$1M pagados acumulados, ahora cubre Next.js/Nuxt/Turborepo/AI SDK. Pero es **security**, no features.
- **.NET Bounty Program** — hasta $40,000 USD por vulnerabilidad. Security-only.
- **GitHub Bug Bounty** — $617 a $30,000+ por vuln. Security-only.
- **Stripe Bug Bounty** — Pagos documentados $1,000 a $25,000 individuales. Security-only.
- **Solana Foundation Anchor bounty** — Hasta $100k en SOL, mínimo $10k. Security-only.

**Nota importante:** la mayoría de los "bounty programs" enterprise grandes son **security**. El bounty marketplace de features que GhBounty quiere atacar tiene mucho menos dinero institucional que el bounty marketplace de security (HackerOne, Bugcrowd están en $100M+ ARR; Algora es bootstrapped 2 personas).

### Tamaño estimado de mercado (TAM/SAM)

**Sin estimación robusta.** Pero triangulando:

- Algora público (oct 2023): ~$65k en 600 bounties acumulados. Probablemente <$500k/año procesado, generously.
- Si asumimos take-rate 10% típico marketplace → revenue Algora <$50k/año en 2023. Esto cuadra con que sea bootstrapped sin VC.
- OBS, AsyncAPI, Maybe Finance, Cal.com individualmente mueven $5k–$20k/año en bounties.
- **El mercado "feature bounty marketplace" hoy probablemente sea <$10M/año global procesado.** Es nicho, no masivo.

Para que GhBounty sea Series A-viable necesita expandir la torta — el ángulo "agentes IA como solvers" podría ser ese expansor, pero **no hay todavía data pública de empresas pagando bounties específicamente para que agentes IA los resuelvan**. Es la hipótesis a validar.

---

## ¿Quién está pagando hoy y cuánto?

**Sizing típico observado (USD, basado en datos públicos de Algora/OpenCollective):**

| Tipo de bounty | Rango típico | Ejemplos |
|---|---|---|
| Bug fix pequeño / docs | $10–$100 | Coolify ($15–$100), Screenpipe testing ($20) |
| Bug fix grande / mejora media | $100–$500 | Zed Vim feature ($100, $500), Onyx ($500) |
| Feature mediana / integración | $500–$2,500 | Maybe (varias $250–$2,500), Twenty IMAP ($2,500), Trieve aggregate ($2,000) |
| Feature grande / refactor crítico | $2,500–$10,000 | PX4 collision prevention ($1,000–multiple), Golem ($3,500–$7,500) |
| Hito tipo "rewrite" / desafío | $10,000–$100,000 | Zama challenges (€15k), Anchor security bounty ($100k) |

**Mediana global del mercado de feature bounties: ~$200–$500.** El top earner de Algora ($55k acumulado total) confirma que pocos developers viven full-time de esto.

**Categorías más comunes (observadas en Algora cross-customer):**
1. Integraciones de terceros (Cal.com → Outlook, Keep → 42 integraciones, Activepieces MCP servers, Hyperswitch payment plugins)
2. Bug fixes priorizados ("high priority" tickets que el equipo interno no quiere/no puede atacar)
3. Feature requests del community roadmap que están desbloqueados pero sin owner
4. Docs y testing (modelo "task crowdsourcing" — Trigger.dev, Screenpipe)

**Tiempo de cierre:** AsyncAPI reporta 75–94% success rate por trimestre, lo cual sugiere ciclos de semanas a 1 trimestre.

---

## Lista de clientes potenciales (13)

> Criterio: solo incluyo empresas con **evidencia pública concreta de willingness to pay** (página Algora activa, bounty en GitHub público, blog post propio sobre bounties, programa OpenCollective). No listo empresas "que deberían interesarse" sin señal.

### Segmento 1 — Startups con backlog grande (Seed–Series B)

#### 1. Twenty (YC S23) — Open-source CRM
- **URL:** [twenty.com](https://twenty.com) / [algora.io/twentyhq/home](https://algora.io/twentyhq/home) / [github.com/twentyhq/twenty](https://github.com/twentyhq/twenty)
- **Por qué encaja:** OSS-first CRM, 44k+ GitHub stars, Series A €4.7M, equipo pequeño (10 empleados) y backlog inmenso. Usan Algora activamente.
- **Señal pública WTP:** $2,500 bounty público para feature IMAP. Página Algora activa con bounties múltiples. Founder Félix Malfait visible en X.
- **Tamaño de backlog:** Repo tiene cientos de issues abiertos (verificar github.com/twentyhq/twenty/issues).
- **Canal de contacto:** Félix Malfait (@_felx en X), founder accesible públicamente.
- **Riesgo "no compra":** Ya están en Algora — switching cost real. Necesitan ver mejora clara (e.g., agentes IA cerrando bounties más rápido) para mover el budget.

#### 2. Cal.com — Open-source scheduling
- **URL:** [cal.com](https://cal.com) / [algora.io/cal/bounties](https://algora.io/cal/bounties)
- **Por qué encaja:** OSS-first, equipo de scheduling con backlog público gigante (>200 issues open en muchos momentos). Inventaron el modelo "bounty-to-hire" en Algora.
- **Señal pública WTP:** 86 contributors paid sobre 2+ años, 14 high-priority + 68 new features + 18 integrations entregadas vía bounty. Issue #21050 (Outlook Cache) público.
- **Tamaño de backlog:** github.com/calcom/cal.com tiene >2k issues abiertos históricamente.
- **Canal de contacto:** Peer Richelsen (@peer_rich) co-founder, activo en X; equipo dev rel.
- **Riesgo "no compra":** Su modelo bounty-to-hire favorece a Algora porque les da el flow completo (bounty + reclutamiento). GhBounty necesita responder qué ofrece extra.

#### 3. Maybe Finance — Personal finance OSS
- **URL:** [maybefinance.com](https://maybefinance.com) / [algora.io/maybe-finance/home](https://algora.io/maybe-finance/home)
- **Por qué encaja:** Resurrección como OSS después de quebrar como SaaS. Backlog enorme, equipo pequeño, founder vocal sobre bounties.
- **Señal pública WTP:** $18,000 budget total declarado en Algora. 58 bounties completadas. Josh Pigford hizo videos en YouTube explicando uso.
- **Tamaño de backlog:** Cientos de issues; típicamente abre 5–10 bounties en paralelo.
- **Canal de contacto:** Josh Pigford (@Shpigford) — extremadamente público y accesible, founder vocal sobre experimentos.
- **Riesgo "no compra":** El total budget de $18k indica que es chico — solo pagaría si GhBounty les ahorra plata neta vs Algora, no porque sea mejor experiencia.

#### 4. Coolify (coollabsio) — Self-hosted PaaS
- **URL:** [coolify.io](https://coolify.io) / [algora.io/coollabsio/bounties/community](https://algora.io/coollabsio/bounties/community)
- **Por qué encaja:** 50k+ stars GitHub, founder solo Andras Bacsai, comunidad enorme dispuesta a contribuir.
- **Señal pública WTP:** $1,382 paid out, 26 bounties completadas. Modelo "community crowdfunds new features" via Algora.
- **Tamaño de backlog:** Cientos de discussions y feature requests.
- **Canal de contacto:** Andras Bacsai (@heyandras) — solo founder, super accesible.
- **Riesgo "no compra":** Bounties chiquitas ($10–$100). El ticket promedio quizá no justifique el overhead de cambiar de plataforma.

#### 5. Trigger.dev — Background jobs / AI workflows
- **URL:** [trigger.dev](https://trigger.dev)
- **Por qué encaja:** OSS-first, fundraised, equipo small, usan bounties para tasks no-código (videos, docs, testing) además de código.
- **Señal pública WTP:** Bounties $100/persona × 10 personas para tasks específicas. Caso de uso documentado en Algora.
- **Tamaño de backlog:** Repo activo con dozens de issues abiertos.
- **Canal de contacto:** Eric Allam (@eallam) o Matt Aitken, co-founders.
- **Riesgo "no compra":** Usan bounties para tasks de bajo valor — el caso de uso "agente IA resuelve PR" puede no resonar acá.

### Segmento 2 — Proyectos OSS con sponsors/foundations

#### 6. PX4 Autopilot (Dronecode Foundation / Linux Foundation)
- **URL:** [px4.io](https://px4.io) / [github.com/PX4/PX4-Autopilot](https://github.com/PX4/PX4-Autopilot)
- **Por qué encaja:** Foundation-backed, comunidad de drones con empresas (ARK Electronics, Ascend Engineering) ya dispuestas a sponsorear bounties. Modelo "industry sponsors fund the OSS".
- **Señal pública WTP:** Bounty $1,000 publicado y pagado para collision prevention. Coverage en UnmannedSystemsTechnology. Múltiples CEOs de drone companies sponsoreando.
- **Tamaño de backlog:** github.com/PX4/PX4-Autopilot tiene >1,500 issues abiertos históricamente.
- **Canal de contacto:** Dronecode Foundation directamente; Lorenz Meier (founder PX4).
- **Riesgo "no compra":** Ya tienen relación con Algora; foundation governance puede hacer slow el switch.

#### 7. AsyncAPI Initiative — Event-driven APIs spec
- **URL:** [asyncapi.com](https://asyncapi.com) / [github.com/asyncapi](https://github.com/asyncapi)
- **Por qué encaja:** Programa quarterly público estructurado. Linux Foundation–style governance, presupuesto declarado.
- **Señal pública WTP:** Programa "Bounty Program 2025-Q1/Q2/Q3" en GitHub Discussions, $5,000/quarter de budget, OpenCollective con presupuesto trackeable.
- **Tamaño de backlog:** github.com/asyncapi organization con 30+ repos.
- **Canal de contacto:** Fran Méndez (founder, @fmvilas en X), o community manager.
- **Riesgo "no compra":** Usan OpenCollective + propio process; pueden ser conservadores en cambiar tooling con governance multi-stakeholder.

#### 8. OBS Project — Open Broadcaster Software
- **URL:** [obsproject.com](https://obsproject.com) / [opencollective.com/obsproject](https://opencollective.com/obsproject)
- **Por qué encaja:** Streaming software con millones de usuarios, programa de bounty maduro (launched 2021), OpenCollective con plata.
- **Señal pública WTP:** $85,822 raised, $9,948 disbursed cumulativo; bounties activos ($31k+ committed a VST3 Support solo).
- **Tamaño de backlog:** github.com/obsproject/obs-studio tiene 1,000+ issues.
- **Canal de contacto:** Equipo de proyecto vía Discord OBS o GitHub.
- **Riesgo "no compra":** Diseñaron el programa **deliberadamente no-competitivo** (anti-race). El modelo "competencia abierta entre solvers" de GhBounty les choca filosóficamente. Necesitarías modo "single assignee" para captarlos.

### Segmento 3 — AI / Dev-tool companies con agent budget

#### 9. Daytona — Sandboxes para AI-generated code
- **URL:** [daytona.io](https://daytona.io) / [algora.io/daytonaio/home](https://algora.io/daytonaio/home)
- **Por qué encaja:** Pledged $60,000 públicamente a OSS, infra exactamente para ejecutar código de agentes IA (overlap fuerte con thesis GhBounty).
- **Señal pública WTP:** Test run $1,375 a 13 contributors; 128 bounties completadas históricas; 16 active bounties en momento de búsqueda.
- **Tamaño de backlog:** github.com/daytonaio/daytona — repo activo, label "Bounty" pública.
- **Canal de contacto:** Ivan Burazin (founder/CEO), accesible en LinkedIn/X.
- **Riesgo "no compra":** Tienen relación buena con Algora; pero el ángulo "agentes IA resolving" debería resonar fuerte con un negocio cuyo producto ES sandboxes para agentes.

#### 10. Activepieces (YC) — Open-source automation / MCP
- **URL:** [activepieces.com](https://www.activepieces.com) / [activepieces.com/mcp/bounty](https://www.activepieces.com/mcp/bounty)
- **Por qué encaja:** MCP Bounty Program activo, modelo "build N pieces" con quota. 80,000+ users descritos en página propia.
- **Señal pública WTP:** Up to $200/integration. 10 active bounties = $1,250. Página propia activepieces.com/mcp/bounty.
- **Tamaño de backlog:** Goal declarado de "1,000 pieces by end of year". Backlog estructural.
- **Canal de contacto:** Ashraf Samhouri (CEO/co-founder), accesible.
- **Riesgo "no compra":** Tickets chicos ($200) — necesitarías capacidad de procesar mucho volumen barato.

#### 11. Browser Use (YC W25) — Open-source web agents
- **URL:** [browser-use.com](https://browser-use.com) / [algora.io/browser-use/bounties/community](https://algora.io/browser-use/bounties/community)
- **Por qué encaja:** 50k stars en 3 meses, AI-native, repo super activo. Perfecto fit para "agentes IA solving agent-related bugs".
- **Señal pública WTP:** $225 en 2 bounties + 1 tip en Algora. Chico todavía pero confirmado modelo.
- **Tamaño de backlog:** Repo tiene cientos de issues abiertos.
- **Canal de contacto:** Magnus Müller / Gregor Zunic (co-founders, basados en SF).
- **Riesgo "no compra":** Volumen aún chico ($225 total). Necesitan crecer su uso de bounties antes de ser cliente serio.

#### 12. Comet (Opik) — LLM observability
- **URL:** [comet.com/opik](https://www.comet.com/docs/opik) / [github.com/comet-ml/opik](https://github.com/comet-ml/opik)
- **Por qué encaja:** Empresa Series A+ con producto open-source (Opik), programa formal de bounty docs. Categoría AI dev tools.
- **Señal pública WTP:** Bounty Program documentado en Opik docs ("contributing/developer-programs/bounties"). Paga vía Algora.
- **Tamaño de backlog:** github.com/comet-ml/opik repo activo.
- **Canal de contacto:** Gideon Mendels (co-founder/CEO), accesible públicamente.
- **Riesgo "no compra":** Programa actualmente "pausado" según docs propios — quizá no priority hoy.

### Segmento 4 — Enterprise eng orgs (>500 devs) / OSS enterprise

#### 13. Juspay / Hyperswitch — Payment orchestration enterprise (India)
- **URL:** [hyperswitch.io](https://hyperswitch.io) / [github.com/juspay/hyperswitch](https://github.com/juspay/hyperswitch)
- **Por qué encaja:** Empresa enterprise (Juspay procesa billions en pagos en India, fundraised), OSS open-source con bounty program formal.
- **Señal pública WTP:** Bounty $2,000 para plugin Prestashop (issue #6000). Wiki "Guidelines for Bounty Program" detallado. Plugin Development Hackathon estructurado.
- **Tamaño de backlog:** Repo activo, Rust, payment integrations infinitas.
- **Canal de contacto:** Vía Juspay company channels; tienen un dev rel team.
- **Riesgo "no compra":** Enterprise / India — sales cycle más largo, posibles preferencias por proveedores locales.

> **Nota sobre segmento 4 (enterprise >500 devs).** No incluyo más enterprise tradicional (Stripe, Sentry, Microsoft, etc.) porque su evidencia pública de bounty pagado es **mayormente security via HackerOne/Bugcrowd**, no feature bounties. Sería gold-plating la lista decir "Stripe es candidate" basándose solo en que tienen bug bounty. La realidad: el segmento 4 según fue definido (enterprise eng orgs paying bounties por features OSS issues) es el **más débil** de los 4 con evidencia pública. Vale la pena revisar la hipótesis: el verdadero "enterprise customer" de GhBounty podría ser **enterprise eng org que mantiene OSS** (Juspay, Cloudflare, IBM tipo programs), no enterprise genérico.

---

## Objeciones probables y respuestas

1. **"Ya uso Algora, ¿por qué cambiar?"**
   - Respuesta defendible: la cuña no es "mejor UX que Algora". Es "agentes IA como solvers nativos + evaluación AI verificable". Eso convierte el modelo de "esperar a que un humano agarre el bounty" en "agentes compitiendo en paralelo desde minuto 0". Para empresas con backlog grande y bounties chicos (categoría Coolify/Activepieces), el throughput debería ser mayor. **Pero esto es hipótesis — hay que demostrarlo con un piloto.**

2. **"Mis devs internos lo hacen gratis"**
   - Esta no la comés. La respondés con segmentación: GhBounty no es para empresas con devs internos suficientes, es para empresas con backlog que **excede** la capacidad interna o donde el costo de oportunidad del dev interno es alto. El public signal (Cal.com, Twenty, Maybe usando Algora) demuestra que ESTAS empresas existen.

3. **"No quiero exponer mi código privado"**
   - Real para enterprise. Respuesta: GhBounty empieza en repos públicos (OSS). Eventual GhBounty Private/Enterprise con NDAs y solver allowlists puede venir después, pero NO es la primera batalla.

4. **"Las bounties traen drama / races / low quality PRs"**
   - Esta sí está bien documentada (HN: "Bounties Damage Open Source Projects"; OBS deliberadamente diseñó anti-race). Respuesta: pipeline automatizado de evaluación (Claude Opus + sandbox tests + GenLayer) **es exactamente la respuesta a esto** — filtra ruido antes de que llegue al maintainer. Pero hay que probarlo.

5. **"Solana / crypto — mi empresa no toca eso"**
   - Real. Respuesta: x402 + USDC funciona como rails, no como producto. Para empresas web2 puras se puede ofrecer fiat off-ramp / Stripe payments encima. **No vender Solana, vender resolución de issues.**

---

## Riesgos para el PMF

- **Mercado chico aunque exista.** Triangulación sugiere <$10M/año global en feature bounties hoy. Para Series A se necesita expandir 10x — la tesis "agentes IA expanden la torta" es plausible pero no validada.
- **Techo natural por size de bounty.** Median ~$200–$500 limita el take rate viable. Algora cobra ~10–20% take y es bootstrapped 2 personas — no es coincidencia.
- **Graveyard sectorial.** Replit Bounties (cerrado 9/2025), Polar issue funding (deprecated), BountySource (muerto), IssueHunt (pivot a security). El pattern es: la categoría es difícil de operar rentablemente sin nicho fuerte.
- **GitHub launches su versión.** GitHub Sponsors ya tiene tracking; un "GitHub Issue Funding" oficial mataría a todos los marketplaces de un golpe. **Mitigación: ser agent-native + cross-chain payment rails es justamente lo que GitHub no construiría con prioridad.**
- **El diferenciador GenLayer + sandbox no está pre-validado por demanda.** Nadie ha pedido explícitamente "AI-verified bounty evaluation". Puede ser un solution-in-search-of-problem. La validación debe priorizar: ¿hay empresas que dirían "pagaría más por bounties si los PRs llegan pre-evaluados"?
- **El angle "agentes IA como solvers" tiene problema de soberanía.** Si Anthropic / OpenAI corren sus propios agentes contra issues públicos como evidence-of-capability, podrían canibalizar el marketplace (y ellos cobran $20/mes vs. comisión por bounty).

---

## Próximos pasos para validar

1. **Outreach manual a 10 founders de la lista — focus en Twenty, Maybe, Daytona, Activepieces (los 4 más accesibles, más vocal y con relación Algora confirmada).** Pregunta clave: ¿qué fricciones tenés hoy con tu bounty program y pagarías más por una solución que las resuelva? Cost: 1 semana de outreach, 0 desarrollo.

2. **Landing + waitlist apuntando explícitamente al gap "AI agents as solvers".** Track: visitors → signups → schedule call. Si <2% convierte a call, la promesa no está pegando. Cost: 1 semana.

3. **Piloto pagado con UN cliente del segmento "AI dev tool".** Idealmente Daytona o Activepieces (overlap thesis fuerte). Set up free para ellos, GhBounty se come la primera comisión, mide: (a) tiempo issue→PR vs Algora baseline, (b) % PRs aceptados, (c) NPS del maintainer. Cost: 4 semanas.

4. **Embed en UN proyecto OSS popular en categoría AI agents** (e.g., OpenHands, Aider, Browser Use). Estos repos tienen muchos contributors AI-friendly, mucho backlog, y son el caso ideal para "agentes IA resolviendo agent-related issues". Cost: depende de la relación.

5. **Estudio dedicado de "agent budget" en empresas Series A AI.** Hoy no hay data pública de empresas con line-item "agentes IA externos resuelven nuestros issues OSS". Si esa línea de presupuesto no existe en presupuestos 2026, GhBounty está vendiendo a budget que todavía no se asignó.

---

## Fuentes (consultadas 2026-05-15)

- [Algora — Bounties homepage](https://algora.io/bounties)
- [Algora — Community/orgs page](https://algora.io/community)
- [Algora — Platform page](https://algora.io/platform)
- [Algora — Twenty (YC S23)](https://algora.io/twentyhq/home)
- [Algora — Cal.com bounties](https://algora.io/cal/bounties/community?fund=calcom%2Fcal.com)
- [Algora — Maybe Finance](https://algora.io/maybe-finance/home)
- [Algora — Coolify](https://algora.io/coollabsio/bounties/community)
- [Algora — Zed Industries](https://algora.io/zed-industries/home)
- [Algora — Golem Cloud](https://algora.io/golemcloud/home)
- [Algora — Daytona](https://algora.io/daytonaio/home)
- [Algora — Browser Use (YC W25)](https://algora.io/browser-use/bounties/community)
- [HN — Replit killing Bounties program (Sept 6, 2025)](https://news.ycombinator.com/item?id=44643875)
- [HN — Show HN: Algora original (Apr 2023)](https://news.ycombinator.com/item?id=35412226)
- [HN — Bounties Damage Open Source Projects](https://news.ycombinator.com/item?id=37541994)
- [HN — Ask HN: Would issue bounties make contributing more appealing?](https://news.ycombinator.com/item?id=26813725)
- [Polar.sh — GitHub funding platform (HN coverage Feb 2024)](https://news.ycombinator.com/item?id=39382281)
- [BuildPilot — Polar.sh Review 2026 (issue funding maintenance mode)](https://trybuildpilot.com/399-polar-sh-open-source-monetization-review-2026)
- [Tuist Blog — Issue and feature bounties (Jan 2023)](https://tuist.dev/blog/2023/01/18/issue-bounties/)
- [PX4 Bounties — UnmannedSystemsTechnology coverage (Dec 2024)](https://www.unmannedsystemstechnology.com/2024/12/px4-bounties-used-to-successfully-fix-and-rewrite-collision-prevention/)
- [PX4 Bounties — Dronecode Forum announcement](https://discuss.px4.io/t/px4-bounties-are-here-solve-an-issue-receive-a-reward/35604)
- [OBS Project Bounty Program — Open Collective](https://opencollective.com/obs-project-bounty-program)
- [OBS Project Bounty Program — GitHub Wiki](https://github.com/obsproject/obs-studio/wiki/OBS-Project-Bounty-Program)
- [AsyncAPI Bounty Program 2025 — GitHub Discussion #1607](https://github.com/orgs/asyncapi/discussions/1607)
- [AsyncAPI Bounty Program — Annual Review 2024](https://www.asyncapi.com/blog/asyncapi-bounty-program-2024)
- [Daytona — Pledges $60,000 to Open Source](https://www.daytona.io/dotfiles/daytona-pledges-60-000-to-support-open-source-community)
- [Activepieces — MCP Bounty Program](https://www.activepieces.com/mcp/bounty)
- [Comet/Opik — Bounty Program docs](https://www.comet.com/docs/opik/contributing/developer-programs/bounties)
- [Hyperswitch (Juspay) — Bounty Program Guidelines](https://github.com/juspay/hyperswitch/wiki/Guidelines-for-Bounty-Program)
- [Hyperswitch — $2,000 Prestashop plugin bounty (issue #6000)](https://github.com/juspay/hyperswitch/issues/6000)
- [Zama — Bounty Program GitHub](https://github.com/zama-ai/bounty-program)
- [Zama — Developer Program announcement](https://www.zama.org/post/launching-the-zama-developer-program-to-support-developers-interested-in-building-the-next-blockchain-primitive-with-fhe)
- [Sentry — $260,028 to OSS Maintainers (blog)](https://blog.sentry.io/we-just-gave-260-028-dollars-to-open-source-maintainers/)
- [ElevenLabs — OSS Engineers Fund blog](https://elevenlabs.io/blog/elevenlabs-oss-engineers-fund-supporting-the-open-source-projects-that-shape-our-work)
- [Vercel — OSS Bug Bounty announcement](https://vercel.com/blog/the-vercel-oss-bug-bounty-program-is-now-available)
- [Solana Foundation — Anchor Security Bounty $100k](https://bitcoinethereumnews.com/tech/solana-launches-100k-bounty-to-boost-anchor-framework-security/)
- [Ethereum Foundation — ESP grants 2025 ($32.6M Q1)](https://cryptoslate.com/ethereum-foundation-boosts-ecosystem-with-32m-in-grants-in-q1-2025/)
- [BountyHub — Launched Jun 2025 (ProductHunt)](https://www.producthunt.com/products/bountyhub)
- [DEV.to — Algora vs Opire comparison](https://dev.to/rohan_sharma/get-ready-bounty-huntersss-algora-vs-opire-30jc)
- [Gitcoin Grants 2025 Strategy](https://www.gitcoin.co/blog/gitcoin-grants-2025-strategy)
- [Coinbase x402 GitHub](https://github.com/coinbase/x402)
- [SWE-bench Pro paper (arXiv Sept 2025)](https://arxiv.org/abs/2509.16941)
- [Cognition — Devin 2025 Performance Review](https://cognition.ai/blog/devin-annual-performance-review-2025)
- [PostHog — Recognizing contributions docs](https://posthog.com/docs/contribute/recognizing-contributions)

---

## Nota sobre debilidades del research

- **Segmento "enterprise eng orgs >500 devs" quedó débil.** No encontré evidencia pública de empresas tipo Fortune 500 pagando feature bounties (sí security bounties, distinto). Lo que existe es empresas como Juspay/IBM/RedHat con OSS-side. La hipótesis "enterprise paga por feature bounties" probablemente sea más débil que lo que el doc original asumió.
- **Falta sizing duro del mercado total.** Algora no publica TPV total, Gitcoin pivoteó a grants, Polar deprecó issue funding. La mejor proxy es triangular por casos individuales — pero un research dedicado a TPV global con análisis de público bounties open + entrevistas a Algora founder mejoraría mucho.
- **No validé directamente la demanda por "agentes IA como solvers".** Es el diferenciador clave de GhBounty pero la evidencia pública hoy se centra en humans pidiendo bounties para humans. Hace falta primary research (entrevistas) para validar si las empresas pagarían **más** o **diferente** por agent-solved bounties.
- **No incluí análisis profundo del modelo Algora interno** — su take rate exacto, churn, etc. Algora bootstrapped y comunicación pública limitada hace difícil estimar revenue real, lo cual importa para entender si el mercado puede sostener un Series A challenger.
- **Lista de 13 vs 15:** preferí 13 con evidencia sólida que 15 con relleno. Browser Use y Comet/Opik son los más "marginales" — los dejé porque tienen overlap thesis fuerte con AI-agent angle, pero su WTP demostrada hoy es chica.
