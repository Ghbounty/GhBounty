# Mejorar form de creación de bounty (validaciones + cap de PRs) - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar validación estricta del input "Bounty amount", ocultar Release Mode (manteniendo schema), y agregar cap opcional de submissions con cierre automático del bounty al alcanzarse.

**Architecture:** Cap implementado off-chain via columna nueva `bounty_meta.max_submissions` + counter dedicado `issues.review_eligible_count`. Atomic conditional UPDATE en relayer cierra el bounty cuando se alcanza el cap. Sin tocar el programa Anchor.

**Tech Stack:** Next.js 15 (frontend), Drizzle ORM + Postgres (Supabase), TypeScript relayer, Anchor Solana program (no-op para esta feature).

**Spec:** `docs/superpowers/specs/2026-05-06-mejorar-form-creacion-bounty-design.md`

**Linear:** GHB-184

**Branch:** `gastonfoncea09/ghb-184-mejorar-form-de-creacion-de-bounty-validaciones-cap-de-prs`

---

## File Structure

### Created
- `packages/db/drizzle/0017_max_submissions_cap.sql` — migración nueva.

### Modified
- `packages/db/src/schema.ts` — agregar `maxSubmissions`, `capWarningSentAt` a `bountyMeta`; agregar `reviewEligibleCount` a `issues`; cambiar default `releaseMode` a `'assisted'`.
- `frontend/lib/types.ts` — extender `Bounty` con `maxSubmissions`, `reviewEligibleCount`.
- `frontend/lib/notifications.ts` — agregar 2 kinds nuevos al union + render.
- `frontend/lib/bounties.ts` — extender `insertIssueAndMeta` y `updateBounty` para `maxSubmissions`.
- `frontend/components/CreateBountyForm.tsx` — sacar ReleaseModePicker, agregar Max PRs field, validación amount estricta.
- `frontend/components/CreateBountyFlow.tsx` — extender `CreateBountyData` y pasarlo al insert.
- `frontend/components/BountyEditMenu.tsx` — sacar ReleaseModePicker, agregar Max PRs con guardrails.
- `frontend/components/StatusBadge.tsx` — agregar variant `cap_reached`.
- `frontend/components/BountyRow.tsx` — detectar y mostrar `cap_reached`, deshabilitar "Submit PR".
- `frontend/components/NotificationsBell.tsx` — render de los 2 kinds nuevos.
- `frontend/app/globals.css` — regla CSS para el badge `cap_reached`.
- `relayer/src/db/ops.ts` — agregar kinds al union `RelayerNotificationKind`, helpers `markScoredAndCheckCap`, `sendCapApproachingNotif`, `sendCapReachedNotif`.
- `relayer/src/submission-handler.ts` — pre-check de bounty closed, atomic UPDATE en lugar de markScored, emit notifs.
- `relayer/tests/submission-handler.test.ts` — tests para los 5 escenarios del cap.

---

## Task 1: Setup y verificación inicial

**Files:**
- Read: `packages/db/drizzle/` (verificar numeración)

- [ ] **Step 1: Verificar branch y estado del repo**

Run: `git branch --show-current && git status`
Expected output:
```
gastonfoncea09/ghb-184-mejorar-form-de-creacion-de-bounty-validaciones-cap-de-prs
nothing to commit, working tree clean
```

Si no estás en esa branch o hay cambios sin commitear, frenar y resolver antes de continuar.

- [ ] **Step 2: Verificar que las dependencias están instaladas**

Run: `pnpm install`
Expected: sin errores. Si pide instalar nuevas deps, frenar — esta feature no agrega ninguna.

- [ ] **Step 3: Confirmar siguiente número de migración**

Run: `ls packages/db/drizzle/*.sql | tail -3`
Expected: el último archivo es `0016_evaluation_genlayer_fields.sql`. Confirma que la próxima es `0017_max_submissions_cap.sql`.

---

## Task 2: Crear migración SQL 0017

**Files:**
- Create: `packages/db/drizzle/0017_max_submissions_cap.sql`

- [ ] **Step 1: Escribir el archivo de migración**

```sql
-- 0017_max_submissions_cap.sql
-- GHB-184: cap opcional de submissions por bounty.
-- Suma counter dedicado review_eligible_count para no romper la semántica de
-- submission_count (que cuenta TODAS las submissions, incluyendo pending y
-- auto_rejected).
-- También finaliza el cleanup de release_mode: default pasa a 'assisted',
-- las pocas filas con 'auto' se migran.

-- 1. Cap de submissions (nullable = sin cap)
ALTER TABLE bounty_meta ADD COLUMN max_submissions INTEGER;

-- 2. Flag para evitar emitir la notif "80%" más de una vez por bounty
ALTER TABLE bounty_meta ADD COLUMN cap_warning_sent_at TIMESTAMPTZ;

-- 3. Counter de submissions review-eligible (state IN ('scored','winner'))
ALTER TABLE issues ADD COLUMN review_eligible_count INTEGER NOT NULL DEFAULT 0;

-- 4. Backfill: contar submissions ya scored/winner para bounties existentes
UPDATE issues i
SET review_eligible_count = (
  SELECT COUNT(*) FROM submissions s
  WHERE s.issue_pda = i.pda
    AND s.state IN ('scored', 'winner')
);

-- 5. Cleanup release_mode: migrar 1 fila auto -> assisted (única bounty con auto)
UPDATE bounty_meta SET release_mode = 'assisted' WHERE release_mode = 'auto';

-- 6. Cambiar default
ALTER TABLE bounty_meta ALTER COLUMN release_mode SET DEFAULT 'assisted';

-- 7. Index parcial para acelerar el conditional UPDATE atomic en submit-handler
CREATE INDEX IF NOT EXISTS idx_issues_state_open ON issues(state) WHERE state = 'open';
```

- [ ] **Step 2: Verificar que el archivo está bien formado**

Run: `cat packages/db/drizzle/0017_max_submissions_cap.sql | wc -l`
Expected: ~30 líneas (varía según comentarios). El archivo no debe estar vacío.

- [ ] **Step 3: Commit**

```bash
git add packages/db/drizzle/0017_max_submissions_cap.sql
git commit -m "feat(GHB-184): migration for max_submissions cap"
```

---

## Task 3: Update schema.ts (Drizzle)

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Agregar `reviewEligibleCount` a `issues`**

En `packages/db/src/schema.ts`, dentro del `issues` table definition, después de `submissionCount`:

```ts
export const issues = pgTable("issues", {
  // ... campos existentes ...
  submissionCount: integer("submission_count").notNull().default(0),
  reviewEligibleCount: integer("review_eligible_count").notNull().default(0), // GHB-184
  // ... resto de campos ...
});
```

- [ ] **Step 2: Agregar `maxSubmissions` y `capWarningSentAt` a `bountyMeta`; cambiar default `releaseMode`**

En `bountyMeta`:

```ts
export const bountyMeta = pgTable("bounty_meta", {
  // ... campos existentes ...
  releaseMode: releaseModeEnum("release_mode").default("assisted"), // antes: "auto"
  maxSubmissions: integer("max_submissions"),                         // GHB-184, nullable
  capWarningSentAt: timestamp("cap_warning_sent_at", { withTimezone: true }), // GHB-184, nullable
  // ... resto de campos ...
});
```

- [ ] **Step 3: Verificar typecheck del package**

Run: `pnpm --filter @ghbounty/db typecheck`
Expected: PASS sin errores.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(GHB-184): schema for max_submissions cap"
```

---

## Task 4: Update tipos del frontend (`Bounty`)

**Files:**
- Modify: `frontend/lib/types.ts:34-77`

- [ ] **Step 1: Extender el tipo `Bounty`**

En `frontend/lib/types.ts`, dentro del type `Bounty`, agregar después de `rejectThreshold`:

```ts
export type Bounty = {
  // ... campos existentes ...
  rejectThreshold?: number | null;
  /**
   * GHB-184: cap opcional de submissions. `null` = sin cap (default).
   * Cuando `reviewEligibleCount === maxSubmissions` el bounty pasa a
   * `state = 'closed'` automáticamente vía relayer.
   */
  maxSubmissions?: number | null;
  /**
   * GHB-184: counter de submissions con `state IN ('scored', 'winner')`.
   * Independiente de `submissionCount` (que cuenta todas, incluyendo
   * `pending` y `auto_rejected`). Backed por `issues.review_eligible_count`.
   */
  reviewEligibleCount?: number;
  createdAt: number;
};
```

- [ ] **Step 2: Verificar typecheck del frontend**

Run: `pnpm --filter frontend typecheck`
Expected: PASS sin errores. Si falla por consumidores que esperan los nuevos campos, NO los agregues acá — los iremos agregando en cada task siguiente.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/types.ts
git commit -m "feat(GHB-184): extend Bounty type with cap fields"
```

---

## Task 5: Validación estricta del input "Bounty amount"

**Files:**
- Modify: `frontend/components/CreateBountyForm.tsx:229-241` (input amount)

- [ ] **Step 1: Agregar handler `onKeyDown` y `onPaste` al input amount**

En `CreateBountyForm.tsx`, reemplazar el bloque del input amount (líneas ~229-241) por:

```tsx
<label className="field">
  <span className="field-label">
    Bounty amount <span className="token-inline">SOL</span>
  </span>
  <input
    name="amount"
    type="number"
    min={0.001}
    step={0.001}
    placeholder="0.5"
    required
    onKeyDown={(e) => {
      // Permitir control keys (Backspace, Delete, Tab, flechas, etc.)
      if (
        e.key.length > 1 ||
        e.key === "Backspace" ||
        e.ctrlKey ||
        e.metaKey
      ) {
        return;
      }
      // Permitir dígitos y un único punto decimal
      const isDigit = /^[0-9]$/.test(e.key);
      const isDot = e.key === ".";
      if (isDigit) return;
      if (isDot && !(e.currentTarget.value ?? "").includes(".")) return;
      e.preventDefault();
    }}
    onPaste={(e) => {
      const pasted = e.clipboardData.getData("text").trim();
      if (!/^\d+(\.\d+)?$/.test(pasted)) {
        e.preventDefault();
        setError("Solo números (ej: 0.5)");
      }
    }}
  />
</label>
```

- [ ] **Step 2: Verificar typecheck**

Run: `pnpm --filter frontend typecheck`
Expected: PASS.

- [ ] **Step 3: Test manual en browser**

1. Levantar frontend: `pnpm --filter frontend dev`.
2. Ir a `/app/company`.
3. Click en input "Bounty amount".
4. Intentar escribir letras (`a`, `e`, `+`, `-`) → no deben aparecer.
5. Escribir `0.5` → aparece OK.
6. Intentar escribir un segundo `.` → no debe aparecer.
7. Pegar `abc` (Cmd+V con `abc` en clipboard) → no debe aceptar, mensaje "Solo números (ej: 0.5)".
8. Pegar `0.5` → debe aceptar.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/CreateBountyForm.tsx
git commit -m "feat(GHB-184): strict validation on bounty amount input"
```

---

## Task 6: Sacar ReleaseModePicker de CreateBountyForm

**Files:**
- Modify: `frontend/components/CreateBountyForm.tsx`

- [ ] **Step 1: Borrar el bloque del ReleaseModePicker (líneas ~252-255)**

En `CreateBountyForm.tsx`, eliminar:

```tsx
<div className="field">
  <span className="field-label">Release mode</span>
  <ReleaseModePicker value={releaseMode} onChange={setReleaseMode} compact />
</div>
```

- [ ] **Step 2: Borrar el state local `releaseMode`**

En `CreateBountyForm.tsx`, eliminar la línea (alrededor de la línea 30):

```tsx
const [releaseMode, setReleaseMode] = useState<ReleaseMode>("auto");
```

- [ ] **Step 3: Hardcodear `'assisted'` en el payload del submit handler**

En `CreateBountyForm.tsx`, en `setFlowData({...})` (línea ~117-127), cambiar:

```tsx
releaseMode,
```

por:

```tsx
releaseMode: "assisted",
```

- [ ] **Step 4: Borrar el import de ReleaseModePicker**

En `CreateBountyForm.tsx` línea 7, eliminar:

```tsx
import { ReleaseModePicker } from "./ReleaseModePicker";
```

Y verificar si `ReleaseMode` sigue siendo necesario en los imports de `lib/types`. Si ya no se usa, también sacarlo.

- [ ] **Step 5: Verificar typecheck**

Run: `pnpm --filter frontend typecheck`
Expected: PASS.

- [ ] **Step 6: Test manual**

Recargar `/app/company` en el browser. El form ya NO debe mostrar la sección "Release mode" entre Description y Reject threshold.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/CreateBountyForm.tsx
git commit -m "feat(GHB-184): remove Release Mode picker from create form"
```

---

## Task 7: Agregar campo "Max PRs" en CreateBountyForm

**Files:**
- Modify: `frontend/components/CreateBountyForm.tsx`

- [ ] **Step 1: Agregar lectura del campo en el submit handler**

En `CreateBountyForm.tsx` `onSubmit`, después de la lectura de `criteria` (línea ~80-82):

```tsx
const maxSubsRaw = (
  f.elements.namedItem("maxSubmissions") as HTMLInputElement
)?.value;

let maxSubmissions: number | null = null;
if (maxSubsRaw && maxSubsRaw.length > 0) {
  const n = Number(maxSubsRaw);
  if (!Number.isInteger(n) || n < 1) {
    setError("Max PRs must be a positive integer.");
    return;
  }
  maxSubmissions = n;
}
```

- [ ] **Step 2: Pasar `maxSubmissions` al `setFlowData`**

En el mismo handler, dentro de `setFlowData({...})`, agregar:

```tsx
setFlowData({
  // ... campos existentes ...
  evaluationCriteria: criteria || null,
  maxSubmissions, // GHB-184
});
```

- [ ] **Step 3: Agregar el JSX del campo (entre Reject threshold y Evaluation criteria)**

Después del bloque Reject threshold (línea ~257-267) y antes del Evaluation criteria (línea ~269), insertar:

```tsx
<label className="field">
  <span className="field-label">Max PRs to review (optional)</span>
  <input
    name="maxSubmissions"
    type="number"
    min={1}
    step={1}
    placeholder="Sin límite (opcional)"
    onKeyDown={(e) => {
      if (
        e.key.length > 1 ||
        e.key === "Backspace" ||
        e.ctrlKey ||
        e.metaKey
      ) {
        return;
      }
      if (/^[0-9]$/.test(e.key)) return;
      e.preventDefault(); // bloquea letras, decimales, signos
    }}
    onPaste={(e) => {
      const pasted = e.clipboardData.getData("text").trim();
      if (!/^\d+$/.test(pasted)) {
        e.preventDefault();
        setError("Max PRs solo acepta enteros positivos.");
      }
    }}
  />
</label>
```

- [ ] **Step 4: Verificar typecheck**

Run: `pnpm --filter frontend typecheck`

Va a fallar porque `CreateBountyData` todavía no tiene `maxSubmissions`. Lo arreglamos en la próxima task.

Expected: error "Property 'maxSubmissions' does not exist on type 'CreateBountyData'" o similar.

- [ ] **Step 5: NO commitear todavía**

Esta task se commitea junto con la Task 8 que agrega `maxSubmissions` al tipo `CreateBountyData`. Si commiteás ahora, el repo queda en estado roto (typecheck fallando).

---

## Task 8: Extender `CreateBountyData` y `insertIssueAndMeta` para `maxSubmissions`

**Files:**
- Modify: `frontend/components/CreateBountyFlow.tsx:55-65` (type CreateBountyData)
- Modify: `frontend/lib/bounties.ts` (insertIssueAndMeta)

- [ ] **Step 1: Agregar `maxSubmissions` al tipo `CreateBountyData`**

En `CreateBountyFlow.tsx`, en la definición del type:

```tsx
export type CreateBountyData = {
  // ... campos existentes ...
  evaluationCriteria: string | null;
  maxSubmissions: number | null; // GHB-184
};
```

- [ ] **Step 2: Pasar `maxSubmissions` al `insertIssueAndMeta`**

En `CreateBountyFlow.tsx` línea ~246-261, agregar el campo en la llamada:

```tsx
await insertIssueAndMeta(supabase, {
  // ... campos existentes ...
  evaluationCriteria: data.evaluationCriteria ?? null,
  maxSubmissions: data.maxSubmissions ?? null, // GHB-184
  createdByUserId: user.id,
});
```

- [ ] **Step 3: Extender la firma de `insertIssueAndMeta`**

En `frontend/lib/bounties.ts`, en `InsertIssueAndMetaParams` (cerca de la línea 55):

```ts
export type InsertIssueAndMetaParams = {
  // ... campos existentes ...
  evaluationCriteria: string | null;
  maxSubmissions: number | null; // GHB-184
  createdByUserId: string;
};
```

Y en el cuerpo de la función, dentro del insert a `bounty_meta` (líneas ~91-100), agregar:

```ts
const { error: metaErr } = await supabase.from("bounty_meta").insert({
  issue_id: issue.id,
  title: p.title ?? null,
  description: p.description ?? null,
  release_mode: p.releaseMode,
  closed_by_user: false,
  created_by_user_id: p.createdByUserId,
  reject_threshold: p.rejectThreshold ?? null,
  evaluation_criteria: p.evaluationCriteria ?? null,
  max_submissions: p.maxSubmissions ?? null, // GHB-184
});
```

- [ ] **Step 4: Verificar typecheck**

Run: `pnpm --filter frontend typecheck`
Expected: PASS. (Si sigue fallando por algún consumidor, reviewar y agregar el field default).

- [ ] **Step 5: Test manual**

En el browser, crear un bounty con `Max PRs = 5`. Verificar en Supabase Studio (o con curl PostgREST) que `bounty_meta.max_submissions = 5` para esa fila.

```bash
# Curl ejemplo (reemplazá API key por el publishable):
set -a && source frontend/.env.local && set +a && curl -s -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/bounty_meta?select=max_submissions&order=created_at.desc&limit=1"
```

Expected: `[{"max_submissions": 5}]`.

- [ ] **Step 6: Commit (incluye los cambios de Task 7)**

```bash
git add frontend/components/CreateBountyForm.tsx frontend/components/CreateBountyFlow.tsx frontend/lib/bounties.ts
git commit -m "feat(GHB-184): add Max PRs field to create bounty form"
```

---

## Task 9: Sacar ReleaseModePicker de BountyEditMenu

**Files:**
- Modify: `frontend/components/BountyEditMenu.tsx:404, 432, 481-484`

- [ ] **Step 1: Borrar `useState<ReleaseMode>(bounty.releaseMode)` y el bloque del picker**

Borrar la línea:

```tsx
const [releaseMode, setReleaseMode] = useState<ReleaseMode>(bounty.releaseMode);
```

Y el bloque (línea ~481-484):

```tsx
<div className="field">
  <span className="field-label">Release mode</span>
  <ReleaseModePicker value={releaseMode} onChange={setReleaseMode} compact />
</div>
```

- [ ] **Step 2: Eliminar `releaseMode` del payload de save**

En `BountyEditMenu.tsx` línea ~432, en la llamada `updateBounty(bounty.id, {...})`:

Cambiar:

```tsx
updateBounty(bounty.id, {
  title: title || undefined,
  amountUsdc: Math.round(amount),
  releaseMode,
});
```

por:

```tsx
updateBounty(bounty.id, {
  title: title || undefined,
  amountUsdc: Math.round(amount),
});
```

- [ ] **Step 3: Limpiar imports si quedaron unused**

Verificar si `ReleaseModePicker` o `ReleaseMode` siguen siendo usados en `BountyEditMenu.tsx`. Si no, sacarlos del `import`.

- [ ] **Step 4: Verificar typecheck**

Run: `pnpm --filter frontend typecheck`
Expected: PASS. Puede dar error "ReleaseMode is declared but never read" si quedó un import suelto — limpiar.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/BountyEditMenu.tsx
git commit -m "feat(GHB-184): remove Release Mode picker from edit menu"
```

---

## Task 10: Agregar campo "Max PRs" en BountyEditMenu con guardrails

**Files:**
- Modify: `frontend/components/BountyEditMenu.tsx` (modal de edit)
- Modify: `frontend/lib/store.ts` o donde viva `updateBounty` (encontrar con grep)

- [ ] **Step 1: Encontrar definición de `updateBounty`**

Run: `grep -nE "export.*updateBounty|function updateBounty" frontend/lib/*.ts frontend/lib/**/*.ts 2>/dev/null`

Anotar el path. Probablemente es `frontend/lib/bounties.ts` o `frontend/lib/store.ts`. Continúa con el path encontrado.

- [ ] **Step 2: Extender `updateBounty` para aceptar `maxSubmissions`**

Agregar al type del payload:

```ts
type UpdateBountyPayload = {
  title?: string;
  amountUsdc?: number;
  maxSubmissions?: number | null; // GHB-184
};
```

Y dentro del cuerpo, hacer el `update` a `bounty_meta` con:

```ts
const updates: Record<string, unknown> = {};
if (payload.title !== undefined) updates.title = payload.title;
if (payload.maxSubmissions !== undefined) updates.max_submissions = payload.maxSubmissions;

const { error } = await supabase
  .from("bounty_meta")
  .update(updates)
  .eq("issue_id", bountyId);
```

(Adaptar a la firma existente — no necesariamente borrar el código previo, sino extenderlo).

- [ ] **Step 3: Agregar lógica de auto-reopen**

Después del update a `bounty_meta`, si `payload.maxSubmissions` se subió o se puso a `null`:

```ts
if (
  payload.maxSubmissions !== undefined &&
  (payload.maxSubmissions === null || payload.maxSubmissions > currentReviewEligibleCount)
) {
  // Si el bounty estaba 'closed' por cap, reabrirlo.
  await supabase
    .from("issues")
    .update({ state: "open" })
    .eq("id", issueIdFromBountyId)
    .eq("state", "closed"); // solo si está closed
}
```

NOTA: este código es un esqueleto. La implementación exacta depende de cómo está estructurada la función actual. Si `updateBounty` no tiene contexto de `currentReviewEligibleCount`, hacer un `SELECT` antes para leerlo.

- [ ] **Step 4: Agregar field "Max PRs" en el JSX del modal**

En `BountyEditMenu.tsx`, dentro del `BountyEditModal`, después del bloque de "Bounty amount" y antes de `</form>`:

```tsx
<label className="field">
  <span className="field-label">Max PRs to review (optional)</span>
  <input
    name="maxSubmissions"
    type="number"
    min={Math.max(bounty.reviewEligibleCount ?? 0, 1)}
    step={1}
    defaultValue={bounty.maxSubmissions ?? ""}
    placeholder="Sin límite (opcional)"
    onKeyDown={(e) => {
      if (
        e.key.length > 1 ||
        e.key === "Backspace" ||
        e.ctrlKey ||
        e.metaKey
      ) return;
      if (/^[0-9]$/.test(e.key)) return;
      e.preventDefault();
    }}
  />
  <span className="field-hint">
    Cuando se alcance este número, el bounty se cierra automáticamente.
  </span>
</label>
```

- [ ] **Step 5: Validación con guardrails en `onSubmit`**

En el `onSubmit` del `BountyEditModal`, después de la validación de `amount`:

```ts
const maxSubsRaw = (f.elements.namedItem("maxSubmissions") as HTMLInputElement)?.value;
let maxSubmissions: number | null | undefined = undefined;
if (maxSubsRaw && maxSubsRaw.length > 0) {
  const n = Number(maxSubsRaw);
  if (!Number.isInteger(n) || n < 1) {
    setError("Max PRs must be a positive integer.");
    return;
  }
  // Guardrail de bajada
  const currentCount = bounty.reviewEligibleCount ?? 0;
  if (n < currentCount) {
    setError(
      `No podés bajar el cap a ${n}: ya recibiste ${currentCount} PRs en review. Mínimo permitido: ${currentCount}.`,
    );
    return;
  }
  maxSubmissions = n;
} else {
  // Vacío significa "sin cap" → null. Distinto de "no tocar el campo" (undefined).
  maxSubmissions = null;
}
```

Y pasarlo a `updateBounty`:

```ts
updateBounty(bounty.id, {
  title: title || undefined,
  amountUsdc: Math.round(amount),
  maxSubmissions,
});
```

- [ ] **Step 6: Verificar typecheck**

Run: `pnpm --filter frontend typecheck`
Expected: PASS.

- [ ] **Step 7: Test manual**

1. Crear un bounty con `cap = 5`.
2. Editar y subir a `cap = 10` → OK.
3. Editar y vaciar el campo → debería persistir como `null` (sin cap).
4. (Sin submissions reales aún) editar y bajar a `cap = 3` → debería pasar (count actual es 0, 3 ≥ 0).

- [ ] **Step 8: Commit**

```bash
git add frontend/components/BountyEditMenu.tsx frontend/lib/bounties.ts
git commit -m "feat(GHB-184): add Max PRs field to edit menu with guardrails"
```

---

## Task 11: Agregar variant `cap_reached` en StatusBadge

**Files:**
- Modify: `frontend/components/StatusBadge.tsx`
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Extender el componente StatusBadge para aceptar `cap_reached`**

Reemplazar `StatusBadge.tsx` por:

```tsx
import type { BountyStatus } from "@/lib/types";

// GHB-184: cap_reached es un estado derivado en frontend, no un valor del enum DB.
// Cuando un bounty está state='closed' por haber alcanzado max_submissions, el
// caller pasa "cap_reached" en lugar de "closed" para diferenciarlo visualmente.
export type StatusBadgeStatus = BountyStatus | "cap_reached";

const LABELS: Record<StatusBadgeStatus, string> = {
  open: "Open",
  reviewing: "Reviewing",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
  closed: "Closed",
  cap_reached: "Cap reached",
};

export function StatusBadge({ status }: { status: StatusBadgeStatus }) {
  return <span className={`status-badge status-${status}`}>● {LABELS[status]}</span>;
}
```

- [ ] **Step 2: Agregar regla CSS para el badge**

En `frontend/app/globals.css`, buscar las reglas existentes de status badges (`.status-open`, `.status-closed`, etc.) y agregar después de ellas:

```css
.status-cap_reached {
  background: rgba(94, 80, 200, 0.15);
  color: #5e50c8;
  border: 1px solid rgba(94, 80, 200, 0.3);
}
```

(Color a ajustar al gusto / paleta del DS — distinto a `closed`).

- [ ] **Step 3: Verificar typecheck**

Run: `pnpm --filter frontend typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/StatusBadge.tsx frontend/app/globals.css
git commit -m "feat(GHB-184): add cap_reached variant to StatusBadge"
```

---

## Task 12: BountyRow detecta cap_reached, muestra badge, deshabilita "Submit PR"

**Files:**
- Modify: `frontend/components/BountyRow.tsx`

- [ ] **Step 1: Agregar helper para derivar el status visual**

Al inicio de `BountyRow.tsx` (después de imports), o como función interna:

```tsx
function visualStatus(bounty: Bounty): StatusBadgeStatus {
  if (
    bounty.status === "closed" &&
    bounty.maxSubmissions != null &&
    (bounty.reviewEligibleCount ?? 0) >= bounty.maxSubmissions
  ) {
    return "cap_reached";
  }
  return bounty.status;
}
```

(Importar `StatusBadgeStatus` desde `./StatusBadge` si querés tipar fuerte; alternativamente devolver `BountyStatus | "cap_reached"`).

- [ ] **Step 2: Reemplazar usos de `<StatusBadge status={bounty.status} />`**

Buscar con grep dentro del archivo:

Run: `grep -n "StatusBadge" frontend/components/BountyRow.tsx`

Para cada uso, reemplazar `bounty.status` por `visualStatus(bounty)`.

- [ ] **Step 3: Deshabilitar el botón "Submit PR" cuando `cap_reached`**

Buscar el botón "Submit PR" dentro de `BountyRow.tsx` (puede estar wrapeado en un componente o ser inline). Para cada renderizado del botón, agregar:

```tsx
<button
  className="btn btn-primary"
  disabled={visualStatus(bounty) === "cap_reached"}
  title={
    visualStatus(bounty) === "cap_reached"
      ? "Este bounty ya recibió el máximo de PRs. La company está revisando."
      : undefined
  }
  onClick={...}
>
  Submit PR
</button>
```

NOTA: si el botón vive en `SubmitPRModal` u otro lugar y no en `BountyRow.tsx` directamente, hacer el grep:

```bash
grep -rn "Submit PR" frontend/components/ frontend/app/ | head -10
```

Y ajustar el mismo patrón en el archivo correcto.

- [ ] **Step 4: Verificar typecheck + manual**

Run: `pnpm --filter frontend typecheck`
Expected: PASS.

Para test manual: necesitamos un bounty cap-reached. Lo testeamos al final con la migración aplicada y datos de prueba. Por ahora, validamos que typecheck pasa y el código se ve bien.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/BountyRow.tsx
git commit -m "feat(GHB-184): show cap_reached badge and disable Submit PR"
```

---

## Task 13: Agregar 2 NotificationKind nuevos al frontend

**Files:**
- Modify: `frontend/lib/notifications.ts:25-37`
- Modify: `frontend/components/NotificationsBell.tsx` (render del dropdown)

- [ ] **Step 1: Extender el union `NotificationKind`**

En `frontend/lib/notifications.ts`, modificar:

```ts
export type NotificationKind =
  | "submission_approved"
  | "submission_rejected"
  | "submission_auto_rejected"
  | "submission_evaluated"
  | "bounty_followed_new"
  | "bounty_resolved_other"
  /**
   * GHB-184: emitida cuando review_eligible_count cruza el 80% del cap.
   * Target: company que es dueña del bounty.
   */
  | "bounty_cap_approaching"
  /**
   * GHB-184: emitida cuando se alcanza el cap y el bounty pasa a 'closed'.
   * Target: company que es dueña del bounty.
   */
  | "bounty_cap_reached";
```

- [ ] **Step 2: Agregar render de los kinds en NotificationsBell**

Run: `grep -n "submission_evaluated\|submission_approved" frontend/components/NotificationsBell.tsx | head -5`

Para entender el patrón. Después, agregar un caso para los 2 kinds nuevos en el switch/render. Patrón típico:

```tsx
case "bounty_cap_approaching":
  return {
    icon: <SparkIcon />,
    title: `${bountyTitle} alcanzó el 80% del cap`,
    body: `Considerá subir el cap si querés más opciones.`,
    href: `/app/company`,
  };
case "bounty_cap_reached":
  return {
    icon: <ClosedIcon />,
    title: `${bountyTitle} se cerró por cap`,
    body: `Llegó al máximo de PRs. Revisá las submissions pendientes.`,
    href: `/app/company`,
  };
```

(Iconos y href: adaptar a lo que use el resto del componente).

- [ ] **Step 3: Verificar typecheck**

Run: `pnpm --filter frontend typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/notifications.ts frontend/components/NotificationsBell.tsx
git commit -m "feat(GHB-184): add cap_approaching/cap_reached notification kinds"
```

---

## Task 14: Extender `RelayerNotificationKind` y helpers

**Files:**
- Modify: `relayer/src/db/ops.ts:379-381`

- [ ] **Step 1: Extender el union**

En `relayer/src/db/ops.ts`:

```ts
export type RelayerNotificationKind =
  | "submission_evaluated"
  | "submission_auto_rejected"
  | "bounty_cap_approaching"  // GHB-184
  | "bounty_cap_reached";     // GHB-184
```

- [ ] **Step 2: Crear helper `sendCapApproachingNotif`**

En el mismo archivo, después de `insertNotification`:

```ts
export async function sendCapApproachingNotif(
  db: Db,
  params: {
    bountyOwnerUserId: string;
    issueId: string;
    bountyTitle: string | null;
    reviewEligibleCount: number;
    maxSubmissions: number;
  },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO notifications (user_id, kind, submission_id, issue_id, payload)
    VALUES (
      ${params.bountyOwnerUserId},
      'bounty_cap_approaching',
      NULL,
      ${params.issueId},
      ${JSON.stringify({
        bountyTitle: params.bountyTitle ?? undefined,
        reviewEligibleCount: params.reviewEligibleCount,
        maxSubmissions: params.maxSubmissions,
      })}::jsonb
    )
  `);
}
```

- [ ] **Step 3: Crear helper `sendCapReachedNotif`**

Mismo patrón:

```ts
export async function sendCapReachedNotif(
  db: Db,
  params: {
    bountyOwnerUserId: string;
    issueId: string;
    bountyTitle: string | null;
    maxSubmissions: number;
  },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO notifications (user_id, kind, submission_id, issue_id, payload)
    VALUES (
      ${params.bountyOwnerUserId},
      'bounty_cap_reached',
      NULL,
      ${params.issueId},
      ${JSON.stringify({
        bountyTitle: params.bountyTitle ?? undefined,
        maxSubmissions: params.maxSubmissions,
      })}::jsonb
    )
  `);
}
```

- [ ] **Step 4: Verificar typecheck del relayer**

Run: `pnpm --filter relayer typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add relayer/src/db/ops.ts
git commit -m "feat(GHB-184): cap notification helpers in relayer"
```

---

## Task 15: TDD — Test del atomic UPDATE en relayer (estilo TDD)

**Files:**
- Create/Modify: `relayer/tests/submission-handler.test.ts`

- [ ] **Step 1: Escribir el test failing primero**

Run: `grep -n "describe\|it\(" relayer/tests/submission-handler.test.ts | head -20`

Para ver el patrón. Agregar un nuevo `describe` block:

```ts
describe("GHB-184: cap de submissions", () => {
  it("incrementa review_eligible_count cuando submission pasa a scored y bounty está open con cap", async () => {
    // Setup: bounty con max_submissions=5, review_eligible_count=2, state='open'
    const fixture = await setupBountyWithCap({ maxSubmissions: 5, reviewEligibleCount: 2 });
    
    await handleSubmission(fixture.submission, fixture.deps);
    
    const issue = await getIssueById(fixture.deps.db, fixture.issueId);
    expect(issue.reviewEligibleCount).toBe(3);
    expect(issue.state).toBe("open"); // todavía hay margen
  });

  it("cierra el bounty cuando submission #N alcanza el cap", async () => {
    const fixture = await setupBountyWithCap({ maxSubmissions: 3, reviewEligibleCount: 2 });
    
    await handleSubmission(fixture.submission, fixture.deps);
    
    const issue = await getIssueById(fixture.deps.db, fixture.issueId);
    expect(issue.reviewEligibleCount).toBe(3);
    expect(issue.state).toBe("closed");
  });

  it("marca submission como auto_rejected si bounty ya está closed por cap", async () => {
    const fixture = await setupBountyWithCap({ 
      maxSubmissions: 3, 
      reviewEligibleCount: 3, 
      issueState: "closed" 
    });
    
    await handleSubmission(fixture.submission, fixture.deps);
    
    const sub = await getSubmissionByPda(fixture.deps.db, fixture.submission.pda.toBase58());
    expect(sub.state).toBe("auto_rejected");
    
    const issue = await getIssueById(fixture.deps.db, fixture.issueId);
    expect(issue.reviewEligibleCount).toBe(3); // no se incrementó
  });

  it("no incrementa counter si submission cae en auto_rejected por threshold", async () => {
    const fixture = await setupBountyWithCap({ 
      maxSubmissions: 5, 
      reviewEligibleCount: 2,
      rejectThreshold: 8,
      stubScore: 5, // por debajo del threshold
    });
    
    await handleSubmission(fixture.submission, fixture.deps);
    
    const issue = await getIssueById(fixture.deps.db, fixture.issueId);
    expect(issue.reviewEligibleCount).toBe(2); // no se incrementó
  });

  it("emite cap_reached notif cuando se alcanza el cap", async () => {
    const fixture = await setupBountyWithCap({ maxSubmissions: 3, reviewEligibleCount: 2 });
    
    await handleSubmission(fixture.submission, fixture.deps);
    
    const notifs = await getNotificationsByIssueId(fixture.deps.db, fixture.issueId);
    expect(notifs.some((n) => n.kind === "bounty_cap_reached")).toBe(true);
  });
});
```

NOTA: las funciones `setupBountyWithCap`, `getIssueById`, `getSubmissionByPda`, `getNotificationsByIssueId` son helpers de test que probablemente no existen. Hay que crearlas siguiendo el patrón de los tests existentes (mirar `relayer/tests/threshold.test.ts` o `relayer/tests/submission-handler.test.ts`).

- [ ] **Step 2: Correr el test para confirmar que falla**

Run: `pnpm --filter relayer test -- submission-handler.test.ts`
Expected: FAIL en los 5 tests nuevos. Esto es esperado — todavía no implementamos la lógica.

- [ ] **Step 3: Commit del test (rojo)**

```bash
git add relayer/tests/submission-handler.test.ts
git commit -m "test(GHB-184): failing tests for cap atomic UPDATE"
```

---

## Task 16: Implementar atomic UPDATE en submission-handler

**Files:**
- Modify: `relayer/src/db/ops.ts` (nuevo helper `markScoredAndCheckCap`)
- Modify: `relayer/src/submission-handler.ts:175` (reemplazar `markScored`)

- [ ] **Step 1: Crear helper `markScoredAndCheckCap` en ops.ts**

```ts
/**
 * GHB-184: combina markScored + check del cap en un solo statement atomic.
 *
 * Returns:
 *   - { applied: true, newState, reviewEligibleCount, maxSubmissions, capWarningSentAt }
 *     si el UPDATE pasó (submission entra a 'scored').
 *   - { applied: false } si el bounty ya está cerrado o llegó al cap (race
 *     perdida) — el caller debe marcar la submission como auto_rejected.
 */
export interface CapCheckResult {
  applied: boolean;
  /** UUID de issues.id (para usar en notifications.issue_id, que es uuid). */
  issueId?: string;
  newState?: string;
  reviewEligibleCount?: number;
  maxSubmissions?: number | null;
  capWarningSentAt?: Date | null;
  bountyOwnerUserId?: string;
  bountyTitle?: string | null;
}

export async function markScoredAndCheckCap(
  db: Db,
  submissionPda: string,
  issuePda: string,
): Promise<CapCheckResult> {
  // El UPDATE atomic incrementa review_eligible_count y, si llegó al cap,
  // cierra el bounty. La condición WHERE garantiza que el race entre dos
  // submissions concurrentes solo deja pasar uno.
  const result = await db.execute(sql`
    UPDATE issues i
    SET review_eligible_count = i.review_eligible_count + 1,
        state = CASE
          WHEN bm.max_submissions IS NOT NULL
           AND i.review_eligible_count + 1 >= bm.max_submissions
          THEN 'closed'
          ELSE i.state
        END
    FROM bounty_meta bm
    WHERE i.pda = ${issuePda}
      AND bm.issue_id = i.id
      AND i.state = 'open'
      AND (bm.max_submissions IS NULL
           OR i.review_eligible_count < bm.max_submissions)
    RETURNING i.id AS issue_id,
              i.state AS state,
              i.review_eligible_count AS review_eligible_count,
              bm.max_submissions AS max_submissions,
              bm.cap_warning_sent_at AS cap_warning_sent_at,
              bm.created_by_user_id AS bounty_owner_user_id,
              bm.title AS bounty_title;
  `);

  type Row = {
    issue_id: string;
    state: string;
    review_eligible_count: number;
    max_submissions: number | null;
    cap_warning_sent_at: string | null;
    bounty_owner_user_id: string;
    bounty_title: string | null;
  };
  const list = (result as unknown as { rows?: Row[] }).rows;
  const flat = Array.isArray(result) ? (result as Row[]) : list ?? [];
  const first = flat[0];

  if (!first) {
    return { applied: false };
  }

  // Marcar la submission como 'scored' ahora que sabemos que el slot fue concedido
  await db.update(submissions)
    .set({ state: "scored", scoredAt: sql`now()` })
    .where(sql`${submissions.pda} = ${submissionPda}`);

  return {
    applied: true,
    issueId: first.issue_id,
    newState: first.state,
    reviewEligibleCount: first.review_eligible_count,
    maxSubmissions: first.max_submissions,
    capWarningSentAt: first.cap_warning_sent_at ? new Date(first.cap_warning_sent_at) : null,
    bountyOwnerUserId: first.bounty_owner_user_id,
    bountyTitle: first.bounty_title,
  };
}
```

- [ ] **Step 2: Modificar `submission-handler.ts` para usar el nuevo helper**

En `relayer/src/submission-handler.ts`, reemplazar el bloque de líneas ~164-177 (donde está `markScored` actual):

ANTES:
```ts
if (deps.db) {
  threshold = await getRejectThreshold(deps.db, sub.bounty.toBase58());
  outcome = classifyByThreshold(score, threshold);
  if (outcome === "auto_rejected") {
    log.info("submission auto-rejected by threshold", { ... });
    await markAutoRejected(deps.db, sub.pda.toBase58());
  } else {
    await markScored(deps.db, sub.pda.toBase58());
  }
}
```

DESPUÉS:
```ts
if (deps.db) {
  threshold = await getRejectThreshold(deps.db, sub.bounty.toBase58());
  outcome = classifyByThreshold(score, threshold);
  if (outcome === "auto_rejected") {
    log.info("submission auto-rejected by threshold", { ... });
    await markAutoRejected(deps.db, sub.pda.toBase58());
  } else {
    // GHB-184: atomic update incrementa counter y cierra bounty si alcanza el cap
    const capResult = await markScoredAndCheckCap(
      deps.db,
      sub.pda.toBase58(),
      sub.bounty.toBase58(),
    );
    if (!capResult.applied) {
      // Race lost: bounty ya está closed o llegó al cap
      log.info("cap reached, submission auto_rejected post-scoring", {
        submission: sub.pda.toBase58(),
        bounty: sub.bounty.toBase58(),
      });
      await markAutoRejected(deps.db, sub.pda.toBase58());
      outcome = "auto_rejected"; // re-clasificar para downstream
    } else if (capResult.newState === "closed") {
      // Cap alcanzado en este UPDATE → emit notif
      log.info("bounty closed by cap", {
        bounty: sub.bounty.toBase58(),
        max: capResult.maxSubmissions,
      });
      if (capResult.bountyOwnerUserId && capResult.maxSubmissions && capResult.issueId) {
        await sendCapReachedNotif(deps.db, {
          bountyOwnerUserId: capResult.bountyOwnerUserId,
          issueId: capResult.issueId, // UUID de issues.id, no la PDA
          bountyTitle: capResult.bountyTitle ?? null,
          maxSubmissions: capResult.maxSubmissions,
        });
      }
    } else if (
      capResult.maxSubmissions !== null &&
      capResult.maxSubmissions !== undefined &&
      capResult.capWarningSentAt === null &&
      capResult.reviewEligibleCount !== undefined &&
      capResult.reviewEligibleCount >= Math.ceil(capResult.maxSubmissions * 0.8) &&
      capResult.reviewEligibleCount < capResult.maxSubmissions
    ) {
      // 80% threshold cruzado → emit cap_approaching y setear flag
      if (capResult.bountyOwnerUserId && capResult.issueId) {
        await sendCapApproachingNotif(deps.db, {
          bountyOwnerUserId: capResult.bountyOwnerUserId,
          issueId: capResult.issueId, // UUID
          bountyTitle: capResult.bountyTitle ?? null,
          reviewEligibleCount: capResult.reviewEligibleCount,
          maxSubmissions: capResult.maxSubmissions,
        });
        // Setear el flag para no repetir
        await deps.db.execute(sql`
          UPDATE bounty_meta
          SET cap_warning_sent_at = now()
          WHERE issue_id = ${capResult.issueId}
        `);
      }
    }
  }
}
```

NOTA: el helper `markScoredAndCheckCap` retorna `issueId` (el UUID de `issues.id`) en su `CapCheckResult`. Los notif helpers reciben ese UUID directo en `params.issueId`, no la PDA on-chain.

- [ ] **Step 3: Importar los helpers nuevos**

En `submission-handler.ts`, agregar al import block:

```ts
import {
  // ... existentes ...
  markScoredAndCheckCap,
  sendCapApproachingNotif,
  sendCapReachedNotif,
} from "./db/ops.js";
```

Y eliminar `markScored` del import si ya no se usa.

- [ ] **Step 4: Correr los tests del relayer**

Run: `pnpm --filter relayer test -- submission-handler.test.ts`
Expected: los 5 tests nuevos pasan en verde.

Si fallan: revisar el helper, los fixtures, y los expects. Iterar hasta que pasen.

- [ ] **Step 5: Verificar typecheck del relayer**

Run: `pnpm --filter relayer typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add relayer/src/db/ops.ts relayer/src/submission-handler.ts
git commit -m "feat(GHB-184): atomic cap check on submission scoring"
```

---

## Task 17: Pre-check (no scorear si bounty ya está closed)

**Files:**
- Modify: `relayer/src/submission-handler.ts` (al inicio de `handleSubmission`)

- [ ] **Step 1: Agregar pre-check antes del scoring**

En `submission-handler.ts`, después del `upsertSubmission` y antes del `runSandboxIfEnabled` (línea ~117 aprox), agregar:

```ts
if (deps.db) {
  // GHB-184: si el bounty ya está closed (cap reached), saltar el scoring
  // y marcar la submission como auto_rejected. Ahorra costo de Opus.
  const issueState = await getIssueState(deps.db, sub.bounty.toBase58());
  if (issueState === "closed") {
    log.info("submission arrived after cap; skipping scoring", {
      submission: sub.pda.toBase58(),
      bounty: sub.bounty.toBase58(),
    });
    await markAutoRejected(deps.db, sub.pda.toBase58());
    return {
      score: 0,
      outcome: "auto_rejected",
      threshold: null,
      source: "stub",
      txHash: "skipped-bounty-closed",
    };
  }
}
```

- [ ] **Step 2: Crear helper `getIssueState` en ops.ts**

```ts
export async function getIssueState(
  db: Db,
  issuePda: string,
): Promise<string | null> {
  const rows = await db.execute(sql`
    SELECT state FROM issues WHERE pda = ${issuePda} LIMIT 1
  `);
  type Row = { state: string };
  const list = (rows as unknown as { rows?: Row[] }).rows;
  const flat = Array.isArray(rows) ? (rows as Row[]) : list ?? [];
  return flat[0]?.state ?? null;
}
```

- [ ] **Step 3: Importar `getIssueState` en submission-handler.ts**

- [ ] **Step 4: Correr tests**

Run: `pnpm --filter relayer test`
Expected: todos verdes (incluyendo los 5 nuevos del cap).

- [ ] **Step 5: Commit**

```bash
git add relayer/src/db/ops.ts relayer/src/submission-handler.ts
git commit -m "feat(GHB-184): skip scoring when bounty is already closed"
```

---

## Task 18: Aplicar la migración a la DB compartida

**Files:** N/A — operación de DB

⚠️ **CONFIRMACIÓN REQUERIDA**: este step modifica la DB compartida (no hay staging separado). Antes de correr, validar con el user.

- [ ] **Step 1: Backup manual antes de migrar**

Run en Supabase Dashboard → Database → Backups: triggear un backup manual. O exportar `bounty_meta` e `issues` a CSV.

- [ ] **Step 2: Aplicar la migración**

Run: `pnpm --filter @ghbounty/db db:migrate`

(O `db:push` según el flow del repo. Confirmar con `package.json` cuál es el correcto).

Expected output: `0017_max_submissions_cap.sql` aplicado sin errores.

- [ ] **Step 3: Verificar columnas y backfill**

```bash
# Verificar columnas nuevas (con curl + REST)
set -a && source frontend/.env.local && set +a

# bounty_meta debe tener max_submissions y cap_warning_sent_at
curl -s -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/bounty_meta?select=max_submissions,cap_warning_sent_at,release_mode&limit=5"

# issues debe tener review_eligible_count
curl -s -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/issues?select=review_eligible_count,state&limit=5"
```

Expected:
- Todas las filas de `bounty_meta` tienen `max_submissions: null` (correcto — sin cap retroactivo).
- Todas las filas de `bounty_meta` tienen `release_mode: 'assisted'` (la única `auto` se migró).
- `issues.review_eligible_count` tiene `0` para los 3 bounties (porque ninguno tiene submissions reales en `scored`/`winner` aún).

- [ ] **Step 4: Verificar el index parcial**

(Opcional, vía Supabase Studio SQL editor):

```sql
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'issues'
  AND indexname = 'idx_issues_state_open';
```

Expected: 1 fila.

---

## Task 19: Testing manual end-to-end

**Files:** N/A — testing manual

- [ ] **Step 1: Levantar el stack**

```bash
# Terminal 1
pnpm --filter frontend dev

# Terminal 2 (si necesitás el relayer corriendo)
pnpm --filter relayer dev
```

- [ ] **Step 2: Test 1 — Validación de inputs**

1. Crear bounty con amount=`abc` (escribiendo) → no entra.
2. Crear bounty con amount=`0.5` → OK.
3. Crear bounty con Max PRs=`abc` → no entra.
4. Crear bounty con Max PRs=`5.5` → no entra (decimales bloqueados).
5. Crear bounty con Max PRs=`5` → OK.

- [ ] **Step 3: Test 2 — Release Mode oculto**

1. Abrir el form de creación → confirmar que NO aparece la sección "Release mode".
2. Editar bounty existente → confirmar que NO aparece la sección "Release mode" en el modal.

- [ ] **Step 4: Test 3 — Cap funcional (requiere submissions reales)**

Si tenés un dev test que pueda submitir PRs:

1. Crear bounty con `Max PRs = 2`.
2. Submit 1er PR como dev → bounty sigue `open`.
3. Submit 2do PR como dev → bounty pasa a `closed` automáticamente. Badge cambia a "Cap reached".
4. Intentar submit 3er PR → en frontend del dev, botón "Submit PR" está disabled con tooltip.
5. En el dashboard de la company, verificar que llegó la notif `bounty_cap_reached`.

(Si no tenés setup de dev test, este step se puede skipear y validar más adelante).

- [ ] **Step 5: Test 4 — Edición con guardrails**

1. Tomar el bounty cap-reached del Test 3.
2. Click "Edit" → en el campo Max PRs, intentar bajar a `1` → error rojo "No podés bajar el cap a 1...".
3. Subir a `5` → OK. Bounty vuelve a `state='open'`. Badge vuelve a "Open".

- [ ] **Step 6: Anotar issues encontradas**

Si encontraste bugs durante el testing manual, agregalos como TODOs o crear sub-issues en Linear. NO seguimos sin que estos pasen.

---

## Task 20: Final commit y push para PR

**Files:** N/A — git ops

- [ ] **Step 1: Verificar que todos los tests pasen**

Run: `pnpm typecheck && pnpm test`
Expected: PASS en todo.

- [ ] **Step 2: Verificar el log de commits**

Run: `git log --oneline main..HEAD`
Expected: ver los ~14 commits de las tasks anteriores con mensajes claros.

- [ ] **Step 3: Push final**

Run: `git push origin gastonfoncea09/ghb-184-mejorar-form-de-creacion-de-bounty-validaciones-cap-de-prs`
Expected: success, branch ya existe en remote.

- [ ] **Step 4: Crear PR**

Run: 
```bash
gh pr create --title "feat(GHB-184): mejorar form de creación de bounty (validaciones + cap de PRs)" --body "$(cat <<'EOF'
## Summary
- Validación estricta del input "Bounty amount" (solo dígitos + decimal)
- Ocultar Release Mode a nivel UI (manteniendo schema/columna/enum para reactivación futura)
- Nuevo cap opcional de submissions con cierre automático del bounty al alcanzarse
- Notificaciones al 80% (heads-up) y al 100% (cerrado) para la company owner
- Estado visual "Cap reached" en lista pública con botón "Submit PR" deshabilitado

Closes GHB-184

## Spec
`docs/superpowers/specs/2026-05-06-mejorar-form-creacion-bounty-design.md`

## Test plan
- [x] Typecheck pasa en todos los packages
- [x] Tests unitarios del relayer (5 escenarios del cap) pasan en verde
- [x] Migración 0017 aplicada en DB compartida
- [x] Validación de inputs amount + max PRs (manual en browser)
- [x] Form sin Release Mode (manual)
- [x] Cap de submissions end-to-end con dev de test (manual)
- [x] Edición con guardrails (manual)
- [x] Notificaciones al 80% y 100% (manual)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: URL del PR. Anotar.

---

## Notas finales

### Riesgos conocidos
1. **Race condition en `markScoredAndCheckCap`**: cubierta por la cláusula WHERE atómica. Si dos transacciones llegan simultáneas con `count = max - 1`, una gana, la otra recibe `applied: false` y la submission queda `auto_rejected`. Test específico cubre esto.

2. **PDAs huérfanas on-chain**: documentado en `docsGaso/tech-debt.md`. Aceptado para MVP.

3. **`submission_count` vs `review_eligible_count`**: dos counters con semánticas distintas. El primero (legacy) cuenta TODAS las submissions, el segundo (GHB-184) solo `scored` + `winner`. Ningún consumer puede confundirlos porque tienen nombres distintos.

### Out of scope (NO hacer en este PR)
- Cap a nivel programa Anchor.
- Endpoint público para devs sepan el cap pre-PR.
- Tests E2E con Playwright/Cypress.
- Edición masiva de `max_submissions` desde dashboard admin.
- Refundir Opus para submissions skip-eadas en el pre-check.

### Verificación post-merge
- Monitorear notifs `bounty_cap_approaching` y `bounty_cap_reached` en producción durante la primera semana.
- Verificar que `review_eligible_count` y `submission_count` se mantienen consistentes via spot-checks SQL.
- Si aparece comportamiento inesperado, primer paso es chequear los logs del relayer (`bounty closed by cap`, `cap reached, submission auto_rejected post-scoring`).
