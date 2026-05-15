# Research: Competidores de GhBounty (bounties sobre issues OSS)

Fecha: 2026-05-15
Autor: Research GhBounty

---

## TL;DR

- **Algora es el incumbente claro** (referencia "open-source Upwork", usado por 15+ YC + 60+ OSS comerciales), pero no es un líder dominante: arrancó con $65,785/600 bounties paid en oct-2023 y sigue siendo equipo bootstrap de 2 fundadores con ~$150K levantados. No hay moat técnico. Su queja recurrente: **fee del 19-20% sobre el bounty**.
- **El espacio acaba de tener una ola de fracasos**: Replit Bounties cerró silenciosamente el 6-sep-2025; Bountysource murió oficialmente en nov-2023 (bancarrota tras la compra de The Blockchain Group, ~$21k+ robados a devs); Gitcoin desplazó hackathons/bounties a Buidlbox en 2023 y ahora cerró Grants Stack en may-2025; Bountify "permanentemente cerrado".
- **Lo nuevo y bien financiado**: Merit Systems levantó **$10M seed liderado por a16z crypto + Blockchain Capital** en ene-2025 a valuación de $55.5M para construir "open-source capitalism" — protocolo de atribución, no bounty puro, pero juega en el mismo terreno de monetizar contribuciones OSS.
- **El gran cambio de contexto** (2025-2026) que reordena el mercado: explosión de AI slop en OSS. curl cerró su bug bounty en ene-2026 (95% de reports en 2026 eran AI-generated bogus), Ghostty/tldraw/Zig bloquearon PRs externos por defecto, y GitHub mismo está evaluando un "kill switch" para PRs. **Esto castiga a las plataformas que solo pasan plata sin filtrar calidad**, y abre el hueco para evaluación verificable.
- **El espacio de bounties OSS sigue siendo pequeño en volumen**: ninguna plataforma activa pública (Algora, Opire, BountyHub, Octasol, Gibwork, UBounty) reporta >$1M GMV anual. La excepción es OnlyDust con $18M distribuidos en 4 años — pero apunta al ecosistema Starknet/Ethereum y opera más como agencia de coordinación de grants que como bounty marketplace.
- **Algora cobra hasta 20%, Opire 4%, BountyHub 10%, Polar 5%, GitHub Sponsors 0%, OnlyDust ~28% (72% va a contribuidores)**. La carrera al fondo en fees ya pasó; el diferenciador no es fee, es selección y calidad.
- **El "winner-takes-all" del modelo bounty es estructuralmente conflictivo con OSS**: Zig, Ondsel, Hashimoto (Ghostty), Stenberg (curl) escribieron textos públicos en 2023-2026 explicando por qué bounties dañan proyectos OSS (esfuerzo duplicado, competencia vs cooperación, todo el riesgo al contribuidor). GhBounty hereda ese problema si no lo desactiva con producto.
- **Hueco más concreto para GhBounty**: ningún player actual resuelve "muchos PRs autogenerados por agentes, todos plausibles, todos malos — ¿cómo elijo?". Algora/Opire/BountyHub asumen un humano maintainer revisando manualmente. Ese supuesto se rompe en 2026.

---

## Mapa del mercado

| Empresa | Modelo | A quién apunta | Estado | Tracción pública | Diferencial |
|---|---|---|---|---|---|
| **Algora** (PBC) | Bounties + contracts + hiring sobre GitHub. Fee ~19-20% sobre creador. AutoPay. | OSS comercial (YC startups, infra) — "open-source Upwork". | Activo, bootstrap. Equipo de 2. | $65,785 / 600 bounties / 188 contribs (oct-2023). Sin update público desde. ~$150K raised (PitchBook). | Comunidad + AutoPay + recruiting funnel encima de bounties. |
| **Opire** | Bounties sobre GitHub. Bot. Free tier 4% + Stripe, hasta Enterprise $199/mo con 0%. | OSS de cualquier tamaño, hobbyistas. | Activo. | Sin números públicos de GMV. | Fee bajo, paga 100% al dev, bot free. Open-source platform. |
| **BountyHub** | Bounties con Stripe + mecanismo de disputa. 10% fee. | OSS general. | Activo desde oct-2024. | Sin datos públicos. | Disputas built-in, GitHub Marketplace app. |
| **OnlyDust** | Plataforma de coordinación grants + bounties + fellowships. | Web3 OSS (Starknet, Ethereum, Aptos, Zama). | Activo. €3M seed (Fabric, Frst). | $18M distribuidos en 4 años a 4,000 contribs; $700K/mes flowing via 15+ protocols. | Concentración en Web3, no es marketplace abierto sino canal curado. |
| **Merit Systems** | Protocolo de atribución on-chain + bounty tags vía GitHub issues. | OSS critical infra + capital wanting to fund OSS. | Lanzando 2025. $10M seed (a16z crypto + Blockchain Capital). | Pre-producto público en momento del raise. Valuación post-money $55.5M. | "Open-source capitalism" — atribución por % de contribución, no winner-take-all. |
| **UBounty** | Bounties USDC, pagos x402, sponsor paga full upfront. | Devs cripto + agentes. | Activo (dominio ubounty.ai). | Sin números públicos. | x402-native, pago instantáneo USDC al merge. |
| **Octasol** | Bounty trustless en Solana, escrow on-chain, Dev ID. | OSS + Solana ecosystem. | Activo, open-source. | Sin números públicos de GMV. | Escrow on-chain, perfil reputacional Dev ID. |
| **Gibwork** | Marketplace freelance Web3 con bounties GitHub. | Solana ecosystem. | Activo (mainnet desde 2024). | Anécdotas: "8 bounties en 48hrs", "$1,400/1.5 meses" por usuario. | Pagos en cualquier SPL token. |
| **Ubiquity DevPool (UbiquiBot)** | DAO con bot que asigna bounties y autoliquida. | Devs Web3, Ubiquity DAO partners. | Activo. | Bounties listados $50-$400. Sin total. | Self-assignment, autopay, todo gobernado por DAO. |
| **Gitpay** | Plataforma open-source de bounties + payment requests. | OSS general. | Activo, low-profile. Updates en 2026. | Sin tracción pública. | Plataforma open-source self-hostable. |
| **CodeBounty.ai** | Bounties + acceptance criteria explícito, payment on merge. | "Vibecoders" y OSS general. | Activo (sitio vivo). | Sin tracción pública. | Énfasis en spec + acceptance + AI-friendly framing. |
| **Polar.sh** | Monetización OSS (subscripciones, donations, issue funding, products). 5% fee. | Maintainers OSS. $10M Seed (Accel). 17k devs, 100+ países. | Activo, alto crecimiento. | 120% MoM growth en revenue al tiempo del seed. 7.2k GH stars. | No es bounty puro: stack completo de monetización. |
| **GitHub Sponsors** | Sponsorships recurrentes, 0% fee. | Maintainers individuales + orgs. | Activo desde 2019. | No publica GMV agregado. | Default integrado en GitHub, sin marketplace. |
| **Bountysource** *(failure)* | Bounties OSS clásico. | OSS general. | **Cerrado.** Bancarrota nov-2023. | ~$21k+ robados a devs. | — |
| **Replit Bounties** *(failure)* | Bounties + bounty hunters dentro del IDE. | Devs Replit, no-code, hobbyistas. | **Cerrado 6-sep-2025.** | YC + $100M+ raised en la empresa. Sin GMV. | Pivot a AI agents (Replit Agent). |
| **Gitcoin Bounties** *(legacy)* | Bounties Web3 dentro de Gitcoin. | OSS Web3. | Transferido a Buidlbox 2023; Grants Stack cerrado may-2025. | 4,000+ bounty issues 2017-2020. | "Airbnb of software dev" según Forbes (en su día). |
| **IssueHunt** *(pivoted)* | Era OSS bounty platform clásica. | OSS. | **Pivot a "#1 Bug Bounty Platform en Japón"**, ya no es OSS bounties principal. | — | — |
| **Bountify** *(failure)* | Bounties para coding tasks pequeñas. | OSS + dev tasks. | Cerrado permanentemente. | — | — |

---

## Competidores activos

### Algora

**Qué es y cómo funciona.** Plataforma que se autodescribe como "open-source Upwork": permite postear bounties sobre issues GitHub, contratar para contracts, y reclutar full-time engineers basándose en actividad real de repos. Bounty creator paga upfront, Algora retiene fondos en escrow propio y libera con feature "AutoPay" al merge del PR. Tiene SDK público que expone stats de cada org.

**A quién apunta.** Mayormente OSS comerciales de YC/series-A (Cal.com, Twenty, Trieve, Onyx, Keep, Remotion, Qdrant, Zed Editor, Maybe). El público real no son hobbyistas: son startups que usan bounties como filtro de recruiting + ejecución de side-features que no quieren hacer internamente.

**Modelo de negocio.** Fee del bounty creator. Según múltiples fuentes (HN, dev.to vs Opire), Algora cobra **19-20% + Stripe ~3% = ~23% efectivo**. Algora declara que el dev recibe 100% del bounty (el fee lo paga el creador encima). Servicio adicional: matchmaking de hiring.

**Tracción pública.**
- Octubre 2023: **$65,785 awarded a 188 contribuidores en 600 bounties desde 48 países** (cita: Ioannis en Medium, repetido en oss.fund).
- 1,307 GitHub stars en el repo público (autodato del site, 2026).
- $143,000 acumulados en bounties por una sola empresa (Ziverge, testimonio en algora.io/bounties).
- "Trusted by 15+ YC companies and 60+ commercial OSS customers" (autodato).
- Funding: **~$150K** según PitchBook. Equipo de 2 founders (Ioannis y Zaf). Sin Series A pública.

**Qué hacen bien.**
- SEO + presencia en HN. Múltiples Show HNs (abr-2023, oct-2023, abr-2025).
- AutoPay reduce fricción para creador.
- Página de claims + reportes públicos = transparencia.
- Pivot inteligente hacia hiring/contracts encima de bounties — los bounties son funnel.

**Debilidades / quejas reales.**
- HN: "Algora charges a 23% fee over your rewarded bounties (20% Algora fee + 3% Stripe)" — queja frontpage 2023, sigue siendo el primer comment cuando aparece el tema (news.ycombinator.com/item?id=35829168).
- **Incidente Wasmer/Zig (sep-2023)**: el CEO de Wasmer posteó un bounty de $5,000 sobre el repo de Zig sin consultar a maintainers via Algora, lo que disparó la respuesta de Zig "Bounties Damage Open Source Projects". Algora salió mal parada por permitir bounties contra repos sin consentimiento del maintainer.
- Tracción modesta: en 2.5 años pasó de $65k acumulados (2023) sin update público comparable. No hay reporte 2025 de GMV total.
- Bootstrap con $150K — no es un competidor con war chest para defender el segmento.

**Cómo se diferencia GhBounty.** GhBounty no compite en "más comunidad" o "menos fee" — compite en **calidad verificable del PR**. Algora asume que el maintainer revisa cada PR a mano y decide; GhBounty pre-evalúa con Claude Opus + GenLayer y entrega un reporte estructurado. En un mundo donde Algora se llene de PRs auto-generados, ese filtro pasa de "nice to have" a "infraestructura crítica".

---

### Opire

**Qué es y cómo funciona.** Bounties sobre GitHub via OpireBot (comandos `/bounty [amount]`, `/reward [amount]`). Pago vía Stripe. A diferencia de Algora, el creador paga **al claim**, no upfront — la plataforma no retiene fondos en escrow. La plataforma es open source (sitio + docs).

**A quién apunta.** OSS de cualquier tamaño, con un mensaje más amplio que Algora — incluye hobbyistas y solo developers.

**Modelo de negocio.** Free tier (4% Opire + Stripe), Starter $19.99/mo, Pro $39.99/mo, Enterprise $199.99/mo (0% fees). Negocio basado en subscripción + take rate bajo.

**Tracción pública.** Sin datos. Se promociona vía DEV.to / Product Hunt. Plataforma menos visible que Algora.

**Qué hacen bien.** Fee transparente y muy bajo (4% vs 20%). Bot self-serve. No retiene fondos = menos exposición a riesgo Bountysource-style.

**Debilidades.** Falta de comunidad/discovery. Si el creador paga al claim, hay friction adicional: el dev no sabe si el creador realmente pagará. El propio artículo comparativo dev.to lo dice: "Opire faces challenges with adoption".

**Cómo se diferencia GhBounty.** Mismo argumento que vs Algora: GhBounty resuelve el problema upstream (¿qué PR merece ganar?) que ni Opire ni Algora tocan.

---

### BountyHub

**Qué es y cómo funciona.** Plataforma lanzada 5-oct-2024 por Omar Soufiane. Permite postear bounties en issues GitHub. Solvers claim via PR. Pagos vía Stripe. Mecanismo de disputa built-in.

**A quién apunta.** OSS general, GitHub Marketplace app.

**Modelo de negocio.** 10% fee sobre el bounty creator.

**Tracción pública.** Sin datos públicos de GMV. Está en GitHub Marketplace + Product Hunt.

**Qué hacen bien.** El built-in dispute mechanism es un detalle que ni Algora ni Opire mencionan explícitamente — útil cuando hay PRs ambiguos.

**Debilidades.** Late entry sin diferenciación fuerte vs Algora/Opire. No tiene comunidad. Fundador solo.

**Cómo se diferencia GhBounty.** El "mecanismo de disputa" es justamente el bottleneck que GhBounty automatiza con AI evaluation + GenLayer validators. BountyHub admite que disputas existen pero las resuelve a mano.

---

### OnlyDust

**Qué es y cómo funciona.** No es marketplace abierto: es canal curado de funding OSS, con bounties + grants + fellowships. Protocolos pagan, OnlyDust coordina y distribuye a contribuidores. Tiene programa de fellowship ($300-$5,000/mes por 3 meses).

**A quién apunta.** Web3 OSS: Starknet, OP Foundation, Nethermind, Aptos, Zama, Ethereum Foundation, Starkware.

**Modelo de negocio.** Mantiene ~28% del flujo (en 2024, 72% fue redistribuido a maintainers/contribs según ellos).

**Tracción pública.**
- **$18M distribuidos a 4,000 contribuidores en 4 años.**
- **$700K/mes** flowing actualmente vía 15+ protocols.
- €3M seed liderado por Fabric Ventures con participación de Frst, LambdaClass (Ergodic), Stake Capital.

**Qué hacen bien.** Capa de coordinación que los protocolos Web3 efectivamente quieren — no es un marketplace donde cualquiera postea, sino un programa estructurado. Esto los hace más cercanos a una agencia/foundation que a una plataforma. Tracción real y verificada.

**Debilidades.** No es bounty marketplace abierto. La curación implica que el go-to-market es enterprise sales (cerrar protocolos). No escala con efecto de red puro.

**Cómo se diferencia GhBounty.** OnlyDust es complementario, no competidor frontal: si GhBounty fuera un marketplace abierto, OnlyDust podría ser cliente (un protocolo Web3 podría querer postear bounties evaluadas verificablemente). Donde sí compiten: los devs que ahora buscan en OnlyDust podrían bouncer a GhBounty para ejecutar tasks específicos.

---

### Merit Systems

**Qué es y cómo funciona.** Protocolo de atribución on-chain encima de GitHub. Posteás un bounty taggeando un issue con `Merit` + `$[amount]`. La diferencia conceptual: Merit no quiere ser "el platform que paga al ganador", quiere ser **el layer que mide quién contribuyó qué y reparte proporcionalmente**. Concepto: "open-source capitalism".

**A quién apunta.** OSS critical infra + capital aliances (a16z crypto, Blockchain Capital). Founders ex-a16z + ex-Blockchain Capital.

**Modelo de negocio.** Pre-producto público al momento del raise. La intuición es que monetizan via take-rate sobre el flujo de capital que rutean al codebase.

**Tracción pública.**
- **$10M seed (ene-2025)** liderado por a16z crypto + Blockchain Capital, valuación post-money $55.5M.
- Founders: Sam Ragsdale (ex-a16z, diseñó el VM Jolt), Ryan Sproule (ex-Blockchain Capital), Mason Hall.
- "Roll out broader release by end of February" (2025) — no encontré update público posterior verificable.

**Qué hacen bien.** Discurso ambicioso: ataca el problema de fondo (attribution) en vez del síntoma (bounties). Network de inversores top-tier. Encima publican `awesome-x402` repo, lo que muestra que están atentos al stack agente/x402.

**Debilidades / dudas.**
- El producto que mostraron en docs es muy simple (taggear issue con `Merit` + `$amount`) — eso es básicamente Algora. La parte de "attribution protocol" no es pública.
- Pivot detectable: el sitio principal (merit.systems) muestra ahora "Open Agentic Commerce" con productos como x402scan, MPPScan, AgentCash, Poncho. Esto sugiere que el foco original (open-source capitalism vía atribución) está siendo replanteado hacia agentic commerce. **No es confirmable a la fecha si bounties OSS sigue siendo prioridad o quedó como una de las apuestas.**

**Cómo se diferencia GhBounty.** Si Merit Systems pivota fuerte a x402/agentic commerce, **se convierte de competidor frontal a posible aliado/integración** (ambos viven en el mismo stack). Si vuelve al pitch original de bounties OSS, tiene war chest y red para defender — pero todavía no tiene producto evaluable a la fecha.

---

### UBounty (ubounty.ai)

**Qué es y cómo funciona.** Bounties en GitHub con pagos USDC vía x402. Sponsor paga full upfront, dev recibe USDC instantáneo al merge.

**A quién apunta.** Crypto-native devs + agentes AI. Categorías de bounty filtran por dificultad (Easy/Medium/Hard) y reward range.

**Modelo de negocio.** No publica fees.

**Tracción pública.** No publica volumen, # bounties, ni launch date.

**Qué hacen bien.** **Es el competidor más cercano a GhBounty en stack** — x402, USDC, agent-friendly. Si GhBounty no se mueve rápido, UBounty puede ocupar el nicho "bounty marketplace agent-native".

**Debilidades.** Página esquelética sin métricas. Sin evidencia de comunidad o tracción. No menciona evaluación AI ni filtro de calidad — sigue siendo "post bounty, get PR, pay".

**Cómo se diferencia GhBounty.** GhBounty agrega la capa de evaluación verificable (Claude Opus + GenLayer) que UBounty no menciona. Si UBounty solo es "Algora pero con USDC", GhBounty es "Algora pero con juez AI auditado on-chain".

---

### Octasol

**Qué es y cómo funciona.** Bounty platform open-source sobre Solana. Escrow on-chain. Plus: Dev ID — perfil reputacional que agrega GitHub + LeetCode + HackerRank + otras señales.

**A quién apunta.** Devs Solana, proyectos del ecosystem.

**Modelo de negocio.** No publica fee schedule.

**Tracción pública.** Sin números públicos.

**Qué hacen bien.** Dev ID es una idea válida (reputación cross-platform). Open-source.

**Debilidades.** Bajo perfil, sin tracción mostrable, sitio simple.

**Cómo se diferencia GhBounty.** Solapan en stack (Solana escrow). GhBounty no es solo escrow — es escrow + evaluación AI. Octasol asume que el maintainer revisa los PRs.

---

### Gibwork

**Qué es y cómo funciona.** Marketplace freelance Web3 en Solana, con bounty system integrado a GitHub. Smart contracts manejan escrow, pagos en cualquier SPL token.

**A quién apunta.** Devs + creadores en Solana, no solo OSS.

**Modelo de negocio.** No publica fee. Probable take-rate sobre payment.

**Tracción pública.** Mainnet desde 2024. Anécdotas en redes ("8 bounties en 48 horas", "$1,400/1.5 meses por user"). Sin GMV agregado.

**Qué hacen bien.** Stack Solana profundo, pagos en SPL tokens varios.

**Debilidades.** Diluido entre freelance generalista y bounties OSS — no es claro su core. Tracción anecdótica.

**Cómo se diferencia GhBounty.** GhBounty es focused en GitHub issues OSS + agentes AI. Gibwork es freelance generalista.

---

### Ubiquity DevPool / UbiquiBot

**Qué es y cómo funciona.** DAO-driven. Repos partners postean issues, devs auto-asignan, UbiquiBot maneja pricing asistido, follow-up, autopayment al merge. Listing en work.ubq.fi.

**A quién apunta.** Devs Web3 + partners de Ubiquity DAO.

**Modelo de negocio.** Modelo DAO (token UbiquiBot). No clara monetización fiat.

**Tracción pública.** Bounties listados $50-$400. Sin GMV agregado.

**Qué hacen bien.** Self-assignment + autopay = workflow muy limpio para devs.

**Debilidades.** Atado al ecosistema Ubiquity. Onboarding requiere wallet config.

**Cómo se diferencia GhBounty.** GhBounty es marketplace abierto, no DAO. Compiten en stack (escrow on-chain) pero apuntan a personas distintas.

---

### Gitpay

**Qué es y cómo funciona.** Plataforma open-source de bounties + payment requests, self-hostable. Historia: empezó como bounty, evolucionó a payment requests.

**A quién apunta.** OSS general que quiere self-hostear infra de bounties.

**Modelo de negocio.** Operan en Open Collective. Modelo agency-style probable.

**Tracción pública.** Sin tracción pública verificable.

**Qué hacen bien.** Self-hostable, open-source license.

**Debilidades.** No tiene momento ni comunidad observable en 2026.

---

### CodeBounty.ai

**Qué es y cómo funciona.** Bounty platform con énfasis en spec + acceptance criteria. El dev hace PR contra spec, equipo aprueba o pide cambios, paga al merge.

**A quién apunta.** "Vibecoders" (autodato) — devs trabajando con AI. Maintainers OSS.

**Modelo de negocio.** No publica fee.

**Tracción pública.** Sin números públicos.

**Qué hacen bien.** Énfasis explícito en acceptance criteria — pone el spec adelante, no después.

**Debilidades.** Producto joven, sin tracción.

**Cómo se diferencia GhBounty.** Acceptance criteria explícito es bueno, pero GhBounty va más lejos: evaluación AI estructurada (Code Quality, Test Coverage, Requirements, Security) + scoring on-chain.

---

### Polar.sh y GitHub Sponsors (adyacentes, no exactamente bounties)

**Polar.sh** — Monetización OSS amplia (subscripciones, donations, issue funding, digital products). $10M seed (Accel, mar-2024). 17k devs, 120% MoM. Fee 5%. **No es competidor directo de GhBounty pero ataca el mismo wallet de capital — empresas dispuestas a pagar por OSS.** Si Polar agrega más feature de issue funding con evaluación AI, podría volverse competidor.

**GitHub Sponsors** — 0% fee. No es bounty: es sponsorship recurrente. **Es el default que cualquier maintainer ya tiene activo.** GhBounty compite por la atención del maintainer/empresa que ya tiene Sponsors set up pero quiere outcome-based (issue solved) en vez de recurring.

---

## Sección dedicada: fracasos del pasado

### Bountysource (2003-2023)

**Qué intentaron.** Plataforma de bounties OSS de referencia por más de una década. Crowdsourcing donde "backers" pledgean dinero a issues, devs los reclaman al resolverlos.

**Por qué fracasaron (causa raíz).**
1. **Cambios de dueño tóxicos.** CanYa (cripto) la compró en 2017 (diciembre); The Blockchain Group la compró en julio 2020.
2. **Apropiación de fondos de devs.** Cambiaron los TOS para retener bounties no reclamados después de 2 años. Backlash, reversión, pero la confianza ya estaba rota.
3. **Default operativo.** Desde junio 2023, dejaron de pagar bounties con claims verificados.
4. **Bancarrota nov-2023.** ~$21,000+ robados a developers según boehs.org. Site oficialmente "temporarily down" desde mayo 2024.

**Lección aplica a GhBounty.**
- **Custody mata.** Algora retiene fondos en escrow centralizado — replica el mismo riesgo estructural que Bountysource. GhBounty con escrow on-chain en Solana es estructuralmente más resistente a este modo de falla específico, pero solo si los smart contracts son auditados y el rug-pull es imposible por diseño.
- **Confianza es un asset que se acumula lento y se destruye rápido.** Si GhBounty hace una sola decisión arbitraria sobre fondos en escrow, replica el patrón Bountysource y muere.

### Replit Bounties (2022-2025)

**Qué intentaron.** Bounties dentro del IDE de Replit. CEO Amjad Masad lo promocionó en 2023 como "next big thing", con plan de reducir transaction costs a cero e integrar dentro de Replit Agent.

**Por qué fracasaron (causa raíz).**
1. **Pivot a AI products.** Replit Agent (sep-2024) y los productos AI-coding pasaron a ser foco — bounties no tenía el upside de un coding agent SaaS.
2. **Mercado no maduró.** Replit terminó dirigiendo usuarios a Contra (freelance marketplace). Es decir: el segmento "alguien que necesita un script hecho rápido" ya está mejor servido por freelance generalista cuando hay un IDE+agent que hace 80% del trabajo.
3. **Cierre silencioso.** Email del ops lead, sin blog post — señal de que el producto no era estratégico ni reportable.

**Lección aplica a GhBounty.**
- **El segmento "bounties para builds rápidos one-off" colapsa contra AI coding agents.** Si GhBounty no es estructuralmente distinto a "le pago a alguien para que use Cursor", está compitiendo con Cursor + Devin + Copilot directamente.
- **Diferenciador requerido**: GhBounty debe ofrecer algo que el LLM solo (sin marketplace) no puede dar — evaluación verificable, fondos en escrow on-chain, acceso a expertise humano cuando AI falla, marketplace de agentes con reputación.

### Bountify (2013-~2024)

**Qué intentaron.** Bounties para coding tasks pequeñas / tech questions.

**Por qué fracasaron (causa raíz).** Faltó volumen y diferenciación frente a Stack Overflow + Upwork. No se hizo público un anuncio formal de cierre; el dominio bountify.co aparece como permanently closed (varios listings) y registro expira ago-2025.

**Lección aplica a GhBounty.** Bounties para tasks muy chicas pierden contra alternativas más rápidas. GhBounty debe apuntar a bounties **suficientemente grandes** para justificar el overhead de pipeline de evaluación (Claude Opus 200K context + GenLayer scoring). En tasks de $5-$50, el costo computacional de evaluar es mayor que el valor que agregás.

### IssueHunt (2018-presente, pero pivotada)

**Qué intentaron.** Issue-based bounty platform OSS clásica. Integraciones con AntDesign, Jekyll.

**Por qué pivotaron.** Hoy se autodescribe como "#1 Bug Bounty Platform en Japón" — pivot total de OSS bounties a bug bounty corporate en Japón. Esto sugiere que el mercado de OSS bounties no era suficientemente grande/rentable a su escala.

**Lección aplica a GhBounty.** OSS bounty puro es un mercado finito sin escalera. Las opciones de IssueHunt: (a) pivot a bug bounty corporate (lo que hicieron), (b) pivot a hiring/contracts (lo que está haciendo Algora), o (c) diferenciarse con producto fuerte (lo que GhBounty intenta con evaluación AI).

### Gitcoin Bounties (2017-2023, transferido)

**Qué intentaron.** Bounties Web3, "Airbnb of software development" según Forbes. 4,000+ bounty issues entre 2017-2020.

**Por qué se desactivaron.** Gitcoin pivot a quadratic funding + grants. Bounties no encajaba con la tesis "individualismo vs comunidades". Transferido a Buidlbox en ETHDenver 2023 (Buidlbox luego adquirido por HackQuest). Gitcoin Grants Stack mismo cerró en may-2025.

**Lección aplica a GhBounty.** Aun teniendo un buen funding model y comunidad, los bounties son **un nicho dentro del problema más grande de "sostenibilidad OSS"**. Quien empieza con bounties termina presionado a expandirse a grants/sponsorships/hiring (Algora hizo el mismo movimiento). GhBounty debe decidir si se queda en bounties con producto muy bueno, o expande a más superficies. **No es obvio que expandir sea correcto.**

### CodeMill / patrones similares

No encontré evidencia pública verificable de un servicio llamado "CodeMill" específicamente para bounties OSS. **Sin dato público confirmado.** Si era un nombre de proyecto de hace años, no quedó digital footprint relevante a 2026.

---

## Oportunidades detectadas

### 1. Filtrar AI slop es un dolor real que ningún competidor está resolviendo en bounties

**Evidencia.** Enero 2026: curl cierra su bug bounty después de 6 años porque en los primeros 21 días de 2026 recibió 20 reports AI-generated, ninguno con vulnerabilidad real. Mitchell Hashimoto (Ghostty) cerró PRs externos automáticamente. tldraw auto-cierra externos. Zig explícitamente prohíbe LLMs en issues/PRs. GitHub mismo está evaluando "kill switch" para PRs (The Register, feb-2026).

**Por qué Algora/Opire/BountyHub no resuelven esto.** Asumen que un maintainer revisa cada PR. Cuando llegan 50 PRs auto-generados que pasan tests pero son código malo, el maintainer no puede revisar 50.

**Hueco para GhBounty.** Pipeline pre-procesador + Claude Opus 200K + GenLayer scoring por dimensión. **El producto cambia de "marketplace donde postear" a "infraestructura que te deja recibir PRs de agentes sin morir".** Es una propuesta de valor distinta y defendible.

### 2. Agentes AI como solvers de primera clase, no como ciudadanos de segunda

**Evidencia.** UBounty existe y monetiza con x402. GitHub Copilot Coding Agent (GA sep-2025) ya genera PRs autónomos sobre issues asignados. El stack agentic (x402, MCP, A2A) está estandarizándose con Coinbase + Cloudflare como facilitators.

**Por qué Algora/Opire no resuelven esto.** Algora no menciona agentes en su sitio. Opire es manual. UBounty sí, pero solo en payment rail, no en evaluación.

**Hueco para GhBounty.** Ser **el primer marketplace donde un agente AI puede actuar como solver de primera clase con MCP nativo + x402**. Esto incluye: agente postea PR, recibe scoring AI, puede iterar, gana o pierde basado en métricas objetivas — no en si el maintainer "tiene tiempo de revisar".

### 3. Verificabilidad on-chain de la evaluación

**Evidencia.** GenLayer existe y funciona como capa de validadores AI on-chain (validadores con LLMs distintos llegan a consenso, Optimistic Democracy + Verifiable Random Function). En el mundo crypto, "trust the AI judge" es exactamente lo que GenLayer está construyendo para.

**Por qué ningún competidor lo hace.** Algora/Opire/BountyHub son web2 stripe-based: el creador decide solo, sin appeal. BountyHub tiene "dispute mechanism" manual. UBounty/Octasol/Gibwork son crypto-native pero no incorporan evaluación AI verificable.

**Hueco para GhBounty.** Cuando el bounty es alto ($1k+ por feature serio), tanto creador como solver quieren un juez que no sea solo "el maintainer en su humor". Score on-chain + validators distribuidos = appeal posible + trust automatizado.

### 4. Bounties grandes ($500+) con spec clara, no microtareas

**Evidencia.** Bountify cerró. Replit Bounties cerró. Las microtareas las gana AI coding agents directos (Cursor, Devin, Copilot). Las quejas históricas sobre bounties OSS (Zig, Ondsel, Hackaday 2023) son sobre features grandes con bounties chicos: "MIDI tracks de Ardour, $1,380 pledgeados, 3 años de trabajo".

**Hueco para GhBounty.** Apuntar a bounties **suficientemente grandes** para que (a) el pipeline AI valga la pena, (b) los agentes/humanos top quieran competir, (c) la empresa tenga skin in the game. **No competir en $5-$50 tasks** — ahí se pierde contra el coding agent del propio dev.

### 5. Reputación cross-task de solvers (humanos y agentes)

**Evidencia.** Octasol intenta esto con Dev ID. OnlyDust usa contribuciones históricas. Algora muestra perfil de contributor pero superficial.

**Hueco para GhBounty.** Score AI + on-chain por PR no es solo una métrica del bounty puntual — es una credencial portable. Un agente AI que gana 10 bounties con scores >85% es un asset reputacional. Esto puede ser **el lock-in del lado solver**: "mi reputación vive en GhBounty".

---

## Riesgos / amenazas

### 1. GitHub Copilot Coding Agent absorbe el caso de uso

**Evidencia.** Copilot Coding Agent GA desde sep-2025. Asignás un issue, te abre un draft PR con tests pasando. Soporta integración con Linear, Jira, Azure Boards. Microsoft empuja agresivo.

**Impacto.** Si una empresa ya tiene Copilot Enterprise, asignarle un issue al agente es más barato que postear un bounty + esperar. El caso de uso "feature mid-size, tengo presupuesto, quiero outcome" se erosiona.

**Mitigación.** GhBounty no es "agente vs humano" — es **mercado donde múltiples agentes/humanos compiten** y vos elegís al ganador con evaluación verificable. Copilot Coding Agent es **un participante posible**, no un competidor del marketplace en sí. Pero hay riesgo de que Microsoft cierre la integración (Copilot solo gana cuando es invocado dentro de tu org).

### 2. Algora pivota a agentic + integra evaluación AI

**Evidencia.** Algora ya iteró rápido (bounties → contracts → hiring). Tienen distribución (15 YC + 60 OSS). Si suman un pipeline de eval AI básico, copian la propuesta.

**Mitigación.** GhBounty necesita moat técnico — calidad del pipeline de evaluación (Claude Opus 200K + sandbox tests + GenLayer scoring) que no se replica en 3 meses. Y la integración con x402/MCP debe ser muy buena, no checkbox.

### 3. Maintainers OSS adoptan políticas anti-bounty / anti-AI por defecto

**Evidencia.** Zig prohíbe LLMs explícitamente. Ghostty banea PRs AI sin aprobación. tldraw cierra PRs externos. Movimiento "Respectful Open Source" creciendo en 2026.

**Impacto.** Si los maintainers respetados rechazan el modelo bounty + AI por principio, GhBounty no tiene cómo entrar a los proyectos que sí valdrían la pena. El mercado se restringe a proyectos comerciales OSS (Cal.com, Twenty, etc.) — el mismo segmento que Algora.

**Mitigación.** Diseño explícito para no ser intrusivo: bounties solo si el maintainer opt-in, no contra repos sin consentimiento. Caso Wasmer/Zig 2023 con Algora es el anti-ejemplo a no repetir.

### 4. Merit Systems pivota de vuelta a OSS con $10M y captura el segmento

**Evidencia.** $10M de a16z + Blockchain Capital es ~70x lo que Algora tiene. Si Merit ejecuta el discurso original (attribution protocol + bounties), tiene capital para enterprise sales y comunidad agresiva.

**Mitigación.** Hoy Merit parece haber pivotado a "Open Agentic Commerce" (x402scan, AgentCash, etc.). El timing de GhBounty es bueno **si Merit no vuelve**. Si vuelve, hay que llegar antes con producto claro y diferenciador AI evaluation que no es trivial replicar.

### 5. Carrera al fondo de fees + commoditización

**Evidencia.** Algora 19%, Opire 4%, BountyHub 10%, GitHub Sponsors 0%, Polar 5%. Los nuevos entrantes compiten en precio.

**Impacto.** Si GhBounty cobra take rate alto (>10%), pierde a creadores price-sensitive. Si cobra bajo, no monetiza la complejidad del pipeline AI.

**Mitigación.** Pricing basado en valor del bounty + premium por evaluación AI. No competir como "alternativa más barata", competir como "alternativa que filtra calidad". Modelo posible: fee fijo bajo (3-5%) + cargo separado por evaluación AI extendida.

---

## Fuentes

Todas accedidas el 2026-05-15.

- [Algora — algora.io/bounties](https://algora.io/bounties)
- [Algora — algora.io/platform](https://algora.io/platform)
- [Algora — Open source coding bounties (Medium, Ioannis)](https://medium.com/@giannis_34055/algora-open-source-coding-bounties-5083edc5327f)
- [Algora PitchBook profile](https://pitchbook.com/profiles/company/740200-78)
- [Hacker News — Algora 23% fee complaint thread](https://news.ycombinator.com/item?id=35829168)
- [Hacker News — Show HN: Algora (abr-2023)](https://news.ycombinator.com/item?id=35412226)
- [Hacker News — Show HN: Algora open source coding bounties (oct-2023)](https://news.ycombinator.com/item?id=37769595)
- [DEV — Algora vs Opire comparison](https://dev.to/rohan_sharma/get-ready-bounty-huntersss-algora-vs-opire-30jc)
- [Opire — opire.dev/home](https://opire.dev/home)
- [Opire Review — 1capture.io](https://www.1capture.io/blog/opire-review)
- [BountyHub — bountyhub.dev/en/about-us](https://www.bountyhub.dev/en/about-us)
- [BountyHub on Product Hunt](https://www.producthunt.com/products/bountyhub)
- [DEV — Monetizing GitHub Issue resolutions with BountyHub](https://dev.to/omarsoufiane/monetizing-github-issue-resolutions-with-bountyhub-3517)
- [OnlyDust — onlydust.com](https://www.onlydust.com/)
- [Fabric Ventures on OnlyDust investment (Medium)](https://medium.com/fabric-ventures/investing-in-onlydust-pushing-the-contribution-economy-744961d41bbf)
- [Merit Systems — $10M seed announcement (SiliconANGLE)](https://siliconangle.com/2025/01/16/merit-systems-raises-10m-create-new-economic-model-called-open-source-capitalism/)
- [Merit Systems — TheBlock $10M article](https://www.theblock.co/post/335347/merit-systems-raises-10-million-in-round-co-led-by-a16z-crypto-and-blockchain-capital)
- [Merit Systems site (current)](https://www.merit.systems/)
- [Merit-Systems/awesome-x402 (GitHub)](https://github.com/Merit-Systems/awesome-x402)
- [Bountysource Wikipedia](https://en.wikipedia.org/wiki/Bountysource)
- [Bountysource Stole at Least $21k (boehs.org)](https://boehs.org/node/bountysource)
- [Elementary blog — Goodbye Bountysource](https://blog.elementary.io/goodbye-bountysource-hello-github-sponsors/)
- [Replit Bounties shutdown — HN thread](https://news.ycombinator.com/item?id=44643875)
- [Replit Docs — Bounties (deprecated)](https://docs.replit.com/category/bounties)
- [Gitcoin sunsetting Bounties/Hackathons (support page)](https://support.gitcoin.co/gitcoin-knowledge-base/misc/cgrants-bounties-and-hackathons-sunsetting-faq/whats-happening-to-the-hackathons-and-the-bounties-program)
- [Gitcoin Grants Stack winding down (blog)](https://www.gitcoin.co/blog/grants-stack-winds-down--heres-whats-changing-and-what-to-expect)
- [HackQuest acquires BuidlBox (ChainCatcher)](https://www.chaincatcher.com/en/article/2203240)
- [IssueHunt — issuehunt.io](https://issuehunt.io/)
- [Bountify status — Crunchbase](https://www.crunchbase.com/organization/bountify)
- [UBounty — ubounty.ai](https://ubounty.ai/bounties)
- [Octasol — github.com/Octasol/octasol](https://github.com/Octasol/octasol)
- [Gibwork — solanacompass.com](https://solanacompass.com/projects/gibwork)
- [Ubiquity DevPool — work.ubq.fi](https://work.ubq.fi)
- [UbiquiBot GitHub](https://github.com/ubiquity/ubiquibot)
- [Gitpay — gitpay.me](https://gitpay.me/)
- [CodeBounty.ai](https://www.codebounty.ai/)
- [Polar.sh seed announcement](https://polar.sh/blog/polar-seed-announcement)
- [Polar.sh on GitHub](https://github.com/polarsource/polar)
- [GitHub Sponsors](https://github.com/open-source/sponsors)
- [Bounties Damage Open Source Projects (Zig, sep-2023)](https://ziglang.org/news/bounties-damage-open-source-projects/)
- [Bounties Damage Open Source Projects — HN discussion](https://news.ycombinator.com/item?id=37541994)
- [Software bounties are a dumb idea (Ondsel)](https://www.ondsel.com/blog/software-bounties-are-a-dumb-idea/)
- [Do Bounties Hurt FOSS? (Hackaday)](https://hackaday.com/2023/09/27/do-bounties-hurt-foss/)
- [curl ending bug bounty (BleepingComputer)](https://www.bleepingcomputer.com/news/security/curl-ending-bug-bounty-program-after-flood-of-ai-slop-reports/)
- [The end of the curl bug-bounty (Daniel Stenberg, ene-2026)](https://daniel.haxx.se/blog/2026/01/26/the-end-of-the-curl-bug-bounty/)
- [GitHub ponders kill switch for PRs (The Register, feb-2026)](https://www.theregister.com/2026/02/03/github_kill_switch_pull_requests_ai/)
- [How OSS Contribution Policies Changed in Response to AI Slop](https://codenote.net/en/posts/oss-ai-slop-contribution-policy-shift/)
- [AI Slopageddon: How AI-Generated Code Is Destroying Open Source](https://www.kunalganglani.com/blog/ai-slopageddon-open-source-crisis/)
- [Open source maintainers drowning in AI-generated PRs (TheNewStack)](https://thenewstack.io/ai-generated-code-crisis/)
- [GenLayer — genlayer.com](https://www.genlayer.com/)
- [x402 Ecosystem](https://www.x402.org/ecosystem)
- [GitHub Copilot Coding Agent — docs.github.com](https://docs.github.com/copilot/concepts/agents/coding-agent/about-coding-agent)
- [Open-source bounty — Wikipedia](https://en.wikipedia.org/wiki/Open-source_bounty)
- [Bounties OSS.Fund Directory](https://www.oss.fund/categories/bounties/)
- [A Deep Dive Into How OSS Maintainers Review Bug Bounty Reports (arxiv)](https://arxiv.org/html/2409.07670v1)
- [4 trends shaping open source funding (GitHub blog)](https://github.blog/open-source/maintainers/4-trends-shaping-open-source-funding-and-what-they-mean-for-maintainers/)
- [The bounty trap: how open source reward systems exploit (DEV)](https://dev.to/bitsabhi/the-bounty-trap-how-open-source-reward-systems-exploit-the-people-they-claim-to-serve-2k7e)
- [State of AI Code Review Tools in 2025 (DevToolsAcademy)](https://www.devtoolsacademy.com/blog/state-of-ai-code-review-tools-2025/)
- [Cloudflare AI code review at scale](https://blog.cloudflare.com/ai-code-review/)

---

## Nota: partes débiles y próximas búsquedas

- **GMV/volumen actualizado de Algora 2024-2026 no es público.** Solo encontré $65,785 de oct-2023. Próximo paso: scrapear bounties.algora.io via su SDK público y agregar el total, o pedir entrevista a Ioannis directamente.
- **Merit Systems está en flux.** El sitio actual muestra "Open Agentic Commerce" no "open-source capitalism". Falta confirmar si bounties OSS sigue siendo prioridad o pivotaron de plano. Próximo paso: stalkear founders en X/LinkedIn, mirar el roadmap público en GitHub (Merit-Systems org).
- **UBounty y BountyHub son cajas negras.** Cero métricas. Próximo paso: registrarse, hacer test posting de un bounty real (con $5), ver dinámica de matchmaking y latencia.
- **No tengo data sobre cuántos bounties OSS son "completados con éxito" vs "expirados/duplicados/abandonados"**. El paper de arxiv 2019 sobre Gitcoin (4,000 bounties 2017-2020) tenía el dato pero está viejo. Próximo paso: pedirle a Gitcoin/Algora/OnlyDust el ratio de éxito.
- **CodeMill como nombre concreto no aparece en ningún registro.** Si era un servicio real, no quedó digital footprint relevante. Lo dejé marcado como "sin dato público".
