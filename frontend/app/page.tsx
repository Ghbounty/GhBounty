"use client";

/* eslint-disable @next/next/no-img-element */

import { Fragment, useEffect, useRef, useState } from "react";
import type { CSSProperties, SVGProps } from "react";

declare global {
  interface Window {
    initParticles?: (
      canvas: HTMLCanvasElement,
      opts: { intensity?: number; speed?: number; accent?: string }
    ) => { destroy: () => void } | undefined;
  }
}

/* ---------------- icons ---------------- */
type IconProps = { size?: number; stroke?: number };
const makeIcon =
  (d: string) =>
  ({ size = 18, stroke = 1.6 }: IconProps) =>
    (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={d} />
      </svg>
    );

const IconArrow = makeIcon("M5 12h14M13 5l7 7-7 7");
const IconGit = makeIcon(
  "M6 3v12M18 9v12M6 15a3 3 0 100 6 3 3 0 000-6zM18 9a3 3 0 100-6 3 3 0 000 6zM6 21a6 6 0 006-6V9"
);
const IconBrain = makeIcon(
  "M9.5 3a3 3 0 00-3 3v.5A3 3 0 004 10v1a3 3 0 002 2.8V16a3 3 0 003 3h1V3H9.5zM14.5 3a3 3 0 013 3v.5A3 3 0 0120 10v1a3 3 0 01-2 2.8V16a3 3 0 01-3 3h-1V3h1.5z"
);
const IconCheck = makeIcon("M20 6L9 17l-5-5");
const IconBolt = makeIcon("M13 2L4 14h7l-1 8 9-12h-7l1-8z");
const IconLock = makeIcon("M6 11V8a6 6 0 0112 0v3M5 11h14v10H5z");
const IconEye = makeIcon(
  "M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z M12 15a3 3 0 100-6 3 3 0 000 6z"
);
const IconClock = makeIcon("M12 7v5l3 2 M21 12a9 9 0 11-18 0 9 9 0 0118 0z");
const IconBuilding = makeIcon(
  "M3 21V7l6-4v18M9 21h12V11l-6-4 M13 11h2M13 15h2M13 19h2M5 11h2M5 15h2M5 19h2"
);
const IconDev = makeIcon("M16 18l6-6-6-6 M8 6l-6 6 6 6");
const IconQuestion = makeIcon(
  "M12 17h.01 M9.5 9a2.5 2.5 0 115 0c0 1.5-2.5 2-2.5 4 M12 22a10 10 0 100-20 10 10 0 000 20z"
);
const IconWrench = makeIcon(
  "M14.7 6.3a4 4 0 105.4 5.4l-7.1 7.1-3.3-3.3 7.1-7.1-2.1-2.1z"
);
const IconFrown = makeIcon(
  "M8 15s1.5-2 4-2 4 2 4 2 M9 9h.01 M15 9h.01 M12 22a10 10 0 100-20 10 10 0 000 20z"
);
const IconPlus = makeIcon("M12 5v14M5 12h14");

/* ---------------- Nav ---------------- */
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", on);
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <nav className={`nav ${scrolled ? "scrolled" : ""}`}>
      <a href="#" className="nav-logo" aria-label="GH Bounty">
        <img src="/assets/ghbounty-logo.svg" alt="GH Bounty" />
      </a>
      <div className="nav-links">
        <a href="#problem">Problem</a>
        <a href="#solution">Solution</a>
        <a href="#how">How it works</a>
        <a href="#powered-by">Powered by</a>
        <a href="#team">Team</a>
      </div>
      <a href="/app" className="nav-cta">
        Launch App <IconArrow size={14} />
      </a>
    </nav>
  );
}

/* ---------------- Hero ---------------- */
function Hero() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shaderRef = useRef<ReturnType<
    NonNullable<Window["initParticles"]>
  > | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !window.initParticles) return;
    shaderRef.current = window.initParticles(canvasRef.current, {
      intensity: 1.0,
      speed: 1.0,
      accent: "0, 229, 209",
    });
    return () => {
      shaderRef.current?.destroy();
    };
  }, []);

  return (
    <section className="hero" id="top">
      <canvas ref={canvasRef} className="hero-canvas" />
      <div className="hero-grid" />
      <div className="hero-noise" />
      <div className="hero-content">
        <div className="badge hero-anim hero-anim-1">
          <span className="badge-dot" />
          Deployed on mainnet
        </div>
        <h1 className="hero-anim hero-anim-2">
          Automated bounties
          <br />
          <span className="accent">for open source.</span>
        </h1>
        <p className="sub hero-anim hero-anim-4">
          AI agents verify GitHub contributions and release payments instantly
          through onchain escrow.
        </p>
        <div className="hero-ctas hero-anim hero-anim-5">
          <a className="btn btn-primary" href="/app">
            Launch App{" "}
            <span className="arrow-wiggle">
              <IconArrow size={16} />
            </span>
          </a>
          <a className="btn btn-ghost" href="#how">
            See how it works
          </a>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Terminal demo ---------------- */
type TermLine = { k: "cmd" | "out" | "ok"; t: string };
const TERMINAL_SCRIPT: TermLine[] = [
  { k: "cmd", t: "$ ghbounty create --issue org/repo#42 --amount 250" },
  { k: "out", t: "> Connecting wallet 0x94a2…9f1c" },
  { k: "out", t: "> Deploying escrow contract on mainnet…" },
  { k: "ok", t: "✓ Bounty #42 funded with 250 USDC" },
  { k: "cmd", t: "$ ghbounty submit --bounty 42 --pr org/repo#99" },
  { k: "out", t: "> AI validators evaluating PR…" },
  { k: "out", t: "> OpenAI   → passed (score 0.96)" },
  { k: "out", t: "> Ollama   → passed (score 0.91)" },
  { k: "out", t: "> Heurist  → passed (score 0.94)" },
  { k: "ok", t: "✓ GenLayer consensus: 5/5 validators approved" },
  { k: "ok", t: "✓ 250 USDC released to 0x3f7c…a120 in 4.8s" },
];

function Terminal() {
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (idx >= TERMINAL_SCRIPT.length) {
      const t = setTimeout(() => {
        setIdx(0);
        setTyped("");
      }, 3500);
      return () => clearTimeout(t);
    }
    const line = TERMINAL_SCRIPT[idx];
    let i = 0;
    const speed = line.k === "cmd" ? 28 : 10;
    const int = setInterval(() => {
      i++;
      setTyped(line.t.slice(0, i));
      if (i >= line.t.length) {
        clearInterval(int);
        setTimeout(() => {
          setIdx((x) => x + 1);
          setTyped("");
        }, 420);
      }
    }, speed);
    return () => clearInterval(int);
  }, [idx]);

  const cls = (k: TermLine["k"]) =>
    k === "cmd" ? "term-cmd" : k === "ok" ? "term-ok" : "term-out";

  return (
    <div className="terminal-wrap">
      <div className="terminal">
        <div className="terminal-bar">
          <span className="tdot r" />
          <span className="tdot y" />
          <span className="tdot g" />
          <span className="terminal-title">ghbounty — zsh</span>
        </div>
        <div className="terminal-body">
          {TERMINAL_SCRIPT.slice(0, idx).map((l, i) => (
            <span key={i} className={`term-line ${cls(l.k)}`}>
              {l.t}
            </span>
          ))}
          {idx < TERMINAL_SCRIPT.length && (
            <span className={`term-line ${cls(TERMINAL_SCRIPT[idx].k)}`}>
              {typed}
              <span className="term-cursor" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Mouse-tracked card ---------------- */
function GlowCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={ref}
      className="card"
      style={style}
      onMouseMove={(e) => {
        if (!ref.current) return;
        const r = ref.current.getBoundingClientRect();
        ref.current.style.setProperty("--mx", `${e.clientX - r.left}px`);
        ref.current.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
    >
      {children}
    </div>
  );
}

/* ---------------- Problem ---------------- */
function Problem() {
  const items: {
    I: (p: IconProps) => React.ReactElement;
    t: string;
    d: string;
  }[] = [
    {
      I: IconClock,
      t: "Slow PR reviews",
      d: "Bounty issues sit for days or weeks with no feedback loop for contributors.",
    },
    {
      I: IconQuestion,
      t: "Uncertain rewards",
      d: "Developers submit work without knowing if or when they'll actually get paid.",
    },
    {
      I: IconWrench,
      t: "Manual validation",
      d: "Maintainers spend hours reviewing and approving contributions by hand.",
    },
    {
      I: IconFrown,
      t: "Broken DX",
      d: "Opaque processes drive talented contributors away from open source.",
    },
  ];
  return (
    <section id="problem">
      <div className="container">
        <div className="section-head">
          <div className="eyebrow">The problem</div>
          <h2>
            Today, bounties take{" "}
            <span className="accent">weeks. Or never get paid.</span>
          </h2>
          <p>
            From PR submission to payout, contributors and maintainers fight
            the same broken process — every single time.
          </p>
        </div>
        <div className="grid-4">
          {items.map(({ I, t, d }, i) => (
            <GlowCard key={i}>
              <div className="card-icon">
                <I />
              </div>
              <h3>{t}</h3>
              <p>{d}</p>
            </GlowCard>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Solution ---------------- */
function Solution() {
  const items: {
    I: (p: IconProps) => React.ReactElement;
    t: string;
    tag: string;
    d: string;
  }[] = [
    {
      I: IconBrain,
      t: "AI Evaluation",
      tag: "LLM-powered",
      d: "Multi-LLM agents analyze pull requests and contribution quality with deep code understanding.",
    },
    {
      I: IconLock,
      t: "Onchain Escrow",
      tag: "Mainnet",
      d: "Lock USDC in smart contracts before work begins — no trust required.",
    },
    {
      I: IconBolt,
      t: "Instant Payouts",
      tag: "Sub-second",
      d: "Payments release automatically once contributions are approved by validators.",
    },
    {
      I: IconEye,
      t: "Transparent by default",
      tag: "Open",
      d: "Every evaluation step, escrow movement, and payout is verifiable onchain.",
    },
  ];
  return (
    <section
      id="solution"
      style={{
        background:
          "linear-gradient(180deg, transparent, rgba(0,229,209,0.02), transparent)",
      }}
    >
      <div className="container">
        <div className="section-head">
          <div className="eyebrow">The solution</div>
          <h2>
            Automatic verification.{" "}
            <span className="accent">Instant reward.</span>
          </h2>
          <p>
            GH Bounty replaces every manual step with trustless, AI-powered
            automation.
          </p>
        </div>
        <div className="grid-2">
          {items.map(({ I, t, tag, d }, i) => (
            <GlowCard key={i} style={{ padding: "32px" }}>
              <div className="card-icon">
                <I />
              </div>
              <h3>
                {t}
                <span className="tag">{tag}</span>
              </h3>
              <p>{d}</p>
            </GlowCard>
          ))}
        </div>
        <Pipeline />
      </div>
    </section>
  );
}

function Pipeline() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setActive((x) => (x + 1) % 3), 2200);
    return () => clearInterval(i);
  }, []);
  const steps: {
    I: (p: IconProps) => React.ReactElement;
    lbl: string;
    t: string;
  }[] = [
    { I: IconGit, lbl: "Step 01", t: "PR submitted" },
    { I: IconBrain, lbl: "Step 02", t: "Validators reach consensus" },
    { I: IconCheck, lbl: "Step 03", t: "USDC released" },
  ];
  return (
    <div className="pipeline">
      {steps.map((s, i) => (
        <Fragment key={i}>
          <div className={`pipeline-step ${active === i ? "active" : ""}`}>
            <div className="n">
              <s.I />
            </div>
            <div>
              <div className="lbl">{s.lbl}</div>
              <div className="ttl">{s.t}</div>
            </div>
          </div>
          {i < 2 && (
            <div className="pipeline-arrow">
              <IconArrow size={20} />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/* ---------------- How it works ---------------- */
function HowItWorks() {
  const [tab, setTab] = useState<"company" | "dev">("company");

  const companies = [
    {
      t: "Post an issue with a bounty",
      d: "Define scope, acceptance criteria, and reward for any GitHub issue.",
    },
    {
      t: "Deposit funds into escrow",
      d: "Lock USDC into a smart contract. Funds are safe until contribution is verified.",
    },
    {
      t: "Define evaluation criteria",
      d: "Set quality thresholds, test coverage requirements, and code standards.",
    },
    {
      t: "Watch AI do the rest",
      d: "Sit back while validator nodes review incoming PRs around the clock.",
    },
  ];
  const devs = [
    {
      t: "Pick an issue",
      d: "Browse open bounties and claim the one that matches your skills.",
    },
    {
      t: "Submit a PR",
      d: "Push your code to GitHub and link it to the bounty issue.",
    },
    {
      t: "AI evaluates the contribution",
      d: "Multi-LLM agents analyze your code quality, tests, and compliance.",
    },
    {
      t: "Get paid automatically",
      d: "Smart contract releases funds directly to your wallet — no waiting.",
    },
  ];

  const steps = tab === "company" ? companies : devs;

  return (
    <section id="how">
      <div className="container">
        <div className="section-head">
          <div className="eyebrow">How it works</div>
          <h2>
            A trustless journey{" "}
            <span className="accent">from issue to payout.</span>
          </h2>
          <p>
            One unified flow — pick your side to see how GH Bounty&apos;s AI
            layer and onchain escrow connect maintainers and contributors.
          </p>
        </div>

        <div className="how-tabs" role="tablist" aria-label="How it works">
          <button
            role="tab"
            aria-selected={tab === "company"}
            className={`how-tab ${tab === "company" ? "active" : ""}`}
            onClick={() => setTab("company")}
            type="button"
          >
            <IconBuilding size={16} />
            For companies
          </button>
          <button
            role="tab"
            aria-selected={tab === "dev"}
            className={`how-tab ${tab === "dev" ? "active" : ""}`}
            onClick={() => setTab("dev")}
            type="button"
          >
            <IconDev size={16} />
            For developers
          </button>
        </div>

        <div className="track" key={tab}>
          {steps.map((s, i) => (
            <div className="track-step" key={i}>
              <div className="num">{String(i + 1).padStart(2, "0")}</div>
              <div>
                <h4>{s.t}</h4>
                <p>{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Powered by (validators + partners merged) ---------------- */
function PoweredBy() {
  const validators = [
    { src: "/assets/openai.png", n: "OpenAI", s: "Frontier closed models" },
    { src: "/assets/ollama.png", n: "Ollama", s: "Self-hosted open weights" },
    { src: "/assets/heurist.png", n: "Heurist", s: "Open-source LLM gateway" },
  ];
  const partners = [
    { src: "/assets/genlayer.png", n: "GenLayer", s: "AI consensus layer", h: 28 },
    { src: "/assets/github.png", n: "GitHub", s: "Source of truth", h: 28 },
    { src: "/assets/crecimiento.svg", n: "Crecimiento", s: "Ecosystem partner", h: 24 },
  ];
  return (
    <section
      id="powered-by"
      style={{
        background:
          "linear-gradient(180deg, transparent, rgba(0,229,209,0.02), transparent)",
      }}
    >
      <div className="container">
        <div className="section-head">
          <div className="eyebrow">Powered by</div>
          <h2>
            Frontier infrastructure{" "}
            <span className="accent">for trustless dev work.</span>
          </h2>
          <p>
            AI validator nodes run on multiple LLM stacks and reach consensus
            via GenLayer&apos;s Optimistic Democracy. Every step is verifiable,
            no single point of failure, no human gatekeeper.
          </p>
        </div>

        <div className="powered-group">
          <div className="powered-label">AI validators</div>
          <div className="validators">
            {validators.map((v, i) => (
              <div className="validator" key={i}>
                <img src={v.src} alt={v.n} />
                <h4>{v.n}</h4>
                <span>{v.s}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="powered-group">
          <div className="powered-label">Partners</div>
          <div className="partners-row">
            {partners.map((p, i) => (
              <div className="partner" key={i}>
                <div className="partner-logo" style={{ height: 34 }}>
                  <img src={p.src} alt={p.n} style={{ height: p.h }} />
                </div>
                <h4>{p.n}</h4>
                <span>{p.s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Team ---------------- */
function Team() {
  const founders = [
    {
      photo: "/landing/founders/arturo.jpg",
      name: "Arturo Grande",
      role: "Product & Marketing",
      bio: "Product and Marketing for web3 startups since 2022. Scaled a fintech from $5M to $65M USD processed in 3 years.",
      links: [
        { kind: "linkedin", href: "https://www.linkedin.com/in/arturo-grande" },
        { kind: "x", href: "https://x.com/ArtuGrande" },
      ],
    },
    {
      photo: "/landing/founders/tomi.jpg",
      name: "Tomas Mazzitello",
      role: "DeFi Engineering",
      bio: "DeFi engineer since 2022. Shipped for Near, Solv, Linera and Midas. ~80% hackathon win rate.",
      links: [
        { kind: "linkedin", href: "https://www.linkedin.com/in/tomasmazzi/" },
      ],
    },
  ];

  const LinkedInIcon = (p: SVGProps<SVGSVGElement>) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.38-1.85 3.61 0 4.28 2.38 4.28 5.47v6.27zM5.34 7.43a2.06 2.06 0 110-4.12 2.06 2.06 0 010 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
  const XIcon = (p: SVGProps<SVGSVGElement>) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M18.244 2H21.5l-7.44 8.506L23 22h-6.86l-5.37-7.02L4.6 22H1.34l7.96-9.1L1 2h7.035l4.86 6.43L18.244 2zm-1.2 18h1.88L7.05 4H5.07l11.974 16z" />
    </svg>
  );
  const iconFor = (kind: string) =>
    kind === "linkedin" ? <LinkedInIcon /> : <XIcon />;

  return (
    <section id="team">
      <div className="container">
        <div className="section-head">
          <div className="eyebrow">Team</div>
          <h2>
            Built by founders who&apos;ve{" "}
            <span className="accent">shipped real things.</span>
          </h2>
          <p>
            Two operators with complementary scars — DeFi engineering on one
            side, product and growth on the other.
          </p>
        </div>
        <div className="team-grid">
          {founders.map((f) => (
            <div className="founder-card" key={f.name}>
              <img className="founder-photo" src={f.photo} alt={f.name} />
              <div className="founder-meta">
                <h4>{f.name}</h4>
                <div className="founder-role">{f.role}</div>
                <p>{f.bio}</p>
                <div className="founder-links">
                  {f.links.map((l) => (
                    <a
                      key={l.kind}
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${f.name} on ${l.kind}`}
                    >
                      {iconFor(l.kind)}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Live bounties ---------------- */
type Bounty = {
  repo: string;
  title: string;
  amt: number;
  st: "open" | "reviewing" | "paid";
};
const BOUNTY_FEED: Bounty[] = [
  { repo: "solana-labs/web3.js", title: "Add retry logic to RPC client", amt: 420, st: "open" },
  { repo: "langchain-ai/langchain", title: "Fix memory leak in agent executor", amt: 1200, st: "reviewing" },
  { repo: "vercel/next.js", title: "Support async generators in server actions", amt: 2500, st: "open" },
  { repo: "tauri-apps/tauri", title: "Dark mode system theme detection", amt: 320, st: "paid" },
  { repo: "supabase/supabase", title: "Realtime presence channel optimizations", amt: 850, st: "reviewing" },
  { repo: "denoland/deno", title: "Implement WebGPU texture compression", amt: 3400, st: "open" },
];

function LiveBounties() {
  const [rows, setRows] = useState<Bounty[]>(BOUNTY_FEED);
  useEffect(() => {
    const id = setInterval(() => {
      setRows((prev) => {
        const shuffled = [...prev];
        const moved = shuffled.pop();
        if (!moved) return prev;
        const states: Bounty["st"][] = ["open", "reviewing", "paid"];
        shuffled.unshift({
          ...moved,
          st: states[Math.floor(Math.random() * 3)],
        });
        return shuffled;
      });
    }, 2800);
    return () => clearInterval(id);
  }, []);
  return (
    <section>
      <div className="container">
        <div className="section-head">
          <div className="eyebrow">Live on mainnet</div>
          <h2>
            Watch bounties{" "}
            <span className="accent">settle in real time.</span>
          </h2>
          <p>
            Every row below is a real onchain escrow. Status updates stream as
            validators reach consensus.
          </p>
        </div>
        <div className="bounties-feed">
          <div className="bounties-head">
            <span className="live-dot">Live feed</span>
            <span>Updating every 2.8s</span>
          </div>
          {rows.map((r, i) => (
            <div className="bounty-row" key={r.repo + i}>
              <div>
                <div className="repo">{r.repo}</div>
                <div className="title">{r.title}</div>
              </div>
              <div className="amount">{r.amt.toLocaleString()} USDC</div>
              <div className={`status ${r.st}`}>● {r.st}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- FAQ ---------------- */
const FAQS = [
  {
    q: "Who evaluates my pull request?",
    a: "A network of AI validator nodes running frontier LLMs (OpenAI, open-weight models via Ollama, Heurist). Each node reviews the PR independently; consensus is reached via Optimistic Democracy.",
  },
  {
    q: "Which chains and tokens are supported?",
    a: "We support USDC settlements on mainnet today, with multi-chain deployments on the near-term roadmap.",
  },
  {
    q: "How much does GH Bounty cost?",
    a: "We take a 2.5% protocol fee on each settled bounty. There are no listing fees, subscription fees, or hidden costs for contributors.",
  },
];

function FAQ() {
  const [open, setOpen] = useState<number>(0);
  return (
    <section>
      <div className="container">
        <div className="section-head">
          <div className="eyebrow">FAQ</div>
          <h2>
            The questions <span className="accent">everyone asks.</span>
          </h2>
        </div>
        <div className="faq">
          {FAQS.map((f, i) => (
            <div
              className={`faq-item ${open === i ? "open" : ""}`}
              key={i}
            >
              <button
                className="faq-q"
                onClick={() => setOpen(open === i ? -1 : i)}
              >
                {f.q}{" "}
                <span className="plus">
                  <IconPlus size={14} />
                </span>
              </button>
              <div className="faq-a">{f.a}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Final CTA ---------------- */
function FinalCTA() {
  return (
    <section className="cta-section">
      <div className="cta-box">
        <h2>
          Start shipping bounties{" "}
          <span style={{ color: "var(--accent)" }}>in minutes.</span>
        </h2>
        <p>
          Post bounties, earn rewards, and let AI handle the verification. No
          gatekeepers. No waiting.
        </p>
        <div className="hero-ctas">
          <a className="btn btn-primary" href="/app">
            Launch App{" "}
            <span className="arrow-wiggle">
              <IconArrow size={16} />
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Footer ---------------- */
function Footer() {
  const XIcon = (p: SVGProps<SVGSVGElement>) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M18.244 2H21.5l-7.44 8.506L23 22h-6.86l-5.37-7.02L4.6 22H1.34l7.96-9.1L1 2h7.035l4.86 6.43L18.244 2zm-1.2 18h1.88L7.05 4H5.07l11.974 16z" />
    </svg>
  );
  return (
    <footer className="footer">
      <div>
        <img src="/assets/ghbounty-logo.svg" alt="GH Bounty" />
      </div>
      <div className="footer-center">
        <a
          href="https://x.com/ghbountyok"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="X"
        >
          <XIcon />
        </a>
      </div>
      <div className="footer-right">© 2026 GH BOUNTY · ALL RIGHTS RESERVED</div>
    </footer>
  );
}

/* ---------------- Page ---------------- */
export default function Home() {
  return (
    <>
      <Nav />
      <Hero />
      <div style={{ position: "relative", marginTop: "-120px" }}>
        <Terminal />
      </div>
      <Problem />
      <Solution />
      <HowItWorks />
      <LiveBounties />
      <PoweredBy />
      <Team />
      <FAQ />
      <FinalCTA />
      <Footer />
    </>
  );
}
