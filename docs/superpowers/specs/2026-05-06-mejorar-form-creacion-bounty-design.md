# Mejorar form de creación de bounty (validaciones + cap de PRs)

- **Linear**: GHB-184
- **Branch**: `gastonfoncea09/ghb-184-mejorar-form-de-creacion-de-bounty-validaciones-cap-de-prs`
- **Fecha**: 2026-05-06
- **Autor**: Gastón Foncea (con asistencia de Claude)

---

## 1. Contexto y motivación

El form actual de creación de bounty (`frontend/components/CreateBountyForm.tsx`) tiene tres problemas detectados durante la revisión UX:

1. El input "Bounty amount" acepta cualquier carácter (limitación del browser sobre `<input type="number">`), lo que permite pegar texto inválido y solo se atrapa al submit.
2. La opción "Auto-release" del Release Mode no está madura para producción — el AI puede aprobar mal y liberar pago sin posibilidad de revertir. Genera fricción innecesaria al usuario forzándolo a elegir entre dos modos cuando solo uno está listo.
3. Falta una funcionalidad clave: poder **limitar la cantidad de submissions** que recibe un bounty. Hoy una company puede recibir 100 PRs y tener que revisarlos todos.

Esta spec cubre las tres mejoras + un cleanup de schema relacionado.

---

## 2. Resumen de cambios

| # | Área | Cambio |
|---|------|--------|
| 1 | Frontend (form) | Validación estricta del input "Bounty amount" (solo dígitos + decimal). |
| 2 | Frontend + DB | Ocultar Release Mode a nivel UI; cambiar default DB a `'assisted'`; migrar 1 fila existente. |
| 3 | Frontend + DB + Relayer | Cap de submissions: nueva columna `max_submissions` opcional + lógica de cierre automático al alcanzarse. |
| 4 | Frontend (lista) | Estado visual "Cap reached" para devs y company. |
| 5 | Notificaciones | Notif al 80% del cap (heads-up) y al 100% (cerrado). |

---

## 3. Decisiones tomadas durante el brainstorming

| Decisión | Valor | Razonamiento |
|----------|-------|--------------|
| Cap implementado on-chain o off-chain | **Off-chain** (relayer + Postgres) | Llevarlo on-chain implica redeploy del programa Anchor + migración de PDAs existentes (caro y arriesgado en Solana). El "ataque" de saltearlo cuesta ~$0.40 y no produce resultado útil. Documentado como tech debt en `docsGaso/tech-debt.md`. |
| Release Mode: cleanup completo o solo UI | **Solo UI** | Mantenemos columna, enum y componente para reactivación futura cuando la IA esté madura para auto-aprobación. |
| Reject threshold | **Sin cambios** | Funcionalmente útil; el "qué es" queda como tarea de UX en otra issue. |
| `max_submissions` opcional o required | **Opcional, `null` = sin cap** | Default null mantiene comportamiento actual (3 bounties existentes no se afectan). Si la company no se preocupa por capear, no la forzamos. |
| Qué cuenta para el cap | **Solo `scored` + `winner`** (excluye `auto_rejected` y `pending`) | Protege la inbox real de la company. Las auto-rechazadas por `reject_threshold` no deben gastar slots. |
| Comportamiento al alcanzar el cap | **Bounty pasa a `state = closed` automáticamente** | Coherente con la intención del cap (acotar la review). Dejarlo `open` invitaba a confusión. |
| Edición de `max_submissions` post-creación | **Editable con guardrails** | Subir libremente; bajar solo si el nuevo valor ≥ `review_eligible_count` actual. Pasar a `null` siempre permitido. Reabrir desde `closed` por cap también permitido al subir. |
| UX dev cuando bounty está cap-reached | **Visible con badge + botón disabled** | El bounty no se oculta, queda visible como contexto histórico con un badge "Cap reached" y "Submit PR" deshabilitado con tooltip. |
| Notificaciones del cap | **Sí, 80% (heads-up) + 100% (cerrado)** | Da chance a la company de reaccionar antes del cierre automático. |
| Approach técnico para el cap | **Atomic conditional UPDATE con columna nueva** | Sin locks ni triggers. Nueva columna `issues.review_eligible_count` mantiene `submission_count` intacto con su semántica original. |
| Entornos de DB | **Una sola DB compartida** (no migramos a staging separado) | Asunción aceptada por el usuario. La migración SQL afecta producción directamente. |

---

## 4. Cambios al schema

### 4.1 Modificaciones a `packages/db/src/schema.ts`

```ts
// bountyMeta — agregar campos:
export const bountyMeta = pgTable("bounty_meta", {
  // ... campos existentes ...
  releaseMode: releaseModeEnum("release_mode").default("assisted"), // antes: "auto"
  maxSubmissions: integer("max_submissions"),                       // nuevo, nullable
  capWarningSentAt: timestamp("cap_warning_sent_at", { withTimezone: true }), // nuevo, nullable
  // ... otros campos ...
});

// issues — agregar campo:
export const issues = pgTable("issues", {
  // ... campos existentes ...
  reviewEligibleCount: integer("review_eligible_count").notNull().default(0), // nuevo
});
```

### 4.2 Migración SQL (nuevo archivo en `packages/db/drizzle/`)

Nombre tentativo: `00XX_max_submissions_cap.sql` (XX según numeración existente al momento de implementar).

```sql
-- 1. Cap de submissions
ALTER TABLE bounty_meta ADD COLUMN max_submissions INTEGER;
ALTER TABLE bounty_meta ADD COLUMN cap_warning_sent_at TIMESTAMPTZ;

-- 2. Counter de submissions review-eligible
ALTER TABLE issues ADD COLUMN review_eligible_count INTEGER NOT NULL DEFAULT 0;

-- 3. Backfill: contar submissions ya scored/winner para bounties existentes
UPDATE issues i
SET review_eligible_count = (
  SELECT COUNT(*) FROM submissions s
  WHERE s.issue_pda = i.pda
    AND s.state IN ('scored', 'winner')
);

-- 4. Cleanup release_mode: migrar 1 fila auto -> assisted
UPDATE bounty_meta SET release_mode = 'assisted' WHERE release_mode = 'auto';

-- 5. Cambiar default de release_mode
ALTER TABLE bounty_meta ALTER COLUMN release_mode SET DEFAULT 'assisted';

-- 6. Index para el conditional UPDATE atomic
CREATE INDEX IF NOT EXISTS idx_issues_state_open ON issues(state) WHERE state = 'open';
```

### 4.3 Lo que NO cambia en DB

- El enum `release_mode` (sigue con `'auto' | 'assisted'`).
- La columna `release_mode` (se queda).
- El campo `submission_count` en `issues` mantiene su semántica original: se incrementa al crear cada submission (en `pending`) y nunca decrementa, así cuenta TODAS las submissions registradas en el sistema, incluyendo `pending` y `auto_rejected`. Es independiente del cap.
- El enum `issue_state` (`open | closed | cancelled`). El estado "cap reached" es **derivado en frontend**, no un nuevo valor del enum DB.

---

## 5. Cambios al frontend

### 5.1 `CreateBountyForm.tsx`

**Validación del input "Bounty amount"** (campo existente):
- Mantener `<input type="number">` (teclado numérico en mobile).
- Agregar handler `onKeyDown`: bloquear teclas que no sean dígitos `0-9`, un único `.`, Backspace, Delete, Tab, flechas, Home, End.
- Agregar handler `onPaste`: validar contenido contra regex `^\d+(\.\d+)?$`. Si falla → cancelar paste + mensaje breve "Solo números (ej: 0.5)".
- La validación al submit (`Number.isFinite`, `> 0`) se mantiene como segunda barrera.

**Eliminar Release Mode picker**:
- Borrar el bloque `<div className="field"> Release mode <ReleaseModePicker .../> </div>` (~líneas 252-255).
- Borrar `useState<ReleaseMode>("auto")` y `import { ReleaseModePicker }`.
- En el handler de submit, hardcodear `releaseMode: 'assisted'` en el payload pasado a `CreateBountyFlow`.
- **No eliminar** los componentes `ReleaseModePicker.tsx` ni `ReleaseModeBadge` — quedan disponibles para uso futuro.

**Nuevo campo "Max PRs to review"**:
- Posición: **entre "Reject threshold" y "Evaluation criteria"** (después del cleanup de Release Mode, queda como el quinto campo).
- Estructura:
  ```tsx
  <label className="field">
    <span className="field-label">Max PRs to review (optional)</span>
    <input
      type="number"
      name="maxSubmissions"
      min={1}
      step={1}
      placeholder="Sin límite (opcional)"
    />
  </label>
  ```
- Validación cliente: si tiene valor, debe ser entero ≥ 1. Si está vacío → guardar `null`.
- Validación estricta de input (mismo patrón que amount, pero solo enteros):
  - `onKeyDown`: bloquear todo lo que no sea dígito `0-9`, Backspace, Delete, Tab, flechas, Home, End. **No permitir punto decimal.**
  - `onPaste`: validar contra regex `^\d+$`. Si falla → cancelar paste.
- Sin texto auxiliar adicional (mantiene consistencia con el resto del form).

### 5.2 `CreateBountyFlow.tsx`

- Aceptar `maxSubmissions: number | null` en `CreateBountyData`.
- Pasarlo al endpoint que persiste `bounty_meta` después del éxito on-chain.

### 5.3 `BountyEditMenu.tsx`

**Eliminar Release Mode del edit**:
- Borrar el `useState<ReleaseMode>(bounty.releaseMode)` y el `<ReleaseModePicker>` del modal de edit.
- No incluir `releaseMode` en el payload de save (el endpoint lo deja sin tocar; el valor en DB no cambia desde edit).

**Nuevo campo "Max PRs"**:
- Agregar el campo en la misma posición lógica (después de reject threshold).
- Validación con guardrails:
  - Si `nuevoMax < bounty.reviewEligibleCount` → input rojo + mensaje "No podés bajar el cap a {N}: ya recibiste {count} PRs en review. Mínimo permitido: {count}."
  - Subir, mantener o pasar a `null` → siempre permitido.
- Si el bounty está `closed` por cap y la edición sube/limpia el cap → en el endpoint server-side se cambia `state` a `'open'` automáticamente.

### 5.4 `BountyRow.tsx` y `StatusBadge.tsx`

**`StatusBadge`**: agregar nueva variante `cap_reached` como **estado derivado** (NO es un nuevo valor en el enum DB `issue_state`; el state real en DB sigue siendo `'closed'`). La variante se calcula en frontend a partir de `state === 'closed' && maxSubmissions !== null && reviewEligibleCount === maxSubmissions`. El componente recibe esta info como prop computada por `BountyRow` o directamente acepta el bounty completo y deriva internamente — decisión de implementación, ambos válidos. El estilo CSS se agrega como nueva regla en `frontend/app/globals.css` siguiendo el patrón de los otros badges (color distinto al "Closed" manual para diferenciarlos visualmente).

**`BountyRow`**:
- Detectar `cap_reached`: cuando `state === 'closed'` y `maxSubmissions !== null` y `reviewEligibleCount === maxSubmissions`.
- Mostrar badge `cap_reached` en lugar del badge `closed` para esos bounties.
- En la vista del dev (perfil de la company), si `cap_reached`: el botón "Submit PR" se deshabilita con tooltip "Este bounty ya recibió el máximo de PRs. La company está revisando."
- En la vista de la company, sumar (si no existe) un contador "X / Y PRs received" visible para bounties con cap.

### 5.5 `lib/notifications.ts`

Agregar al union `NotificationKind`:
```ts
| "bounty_cap_approaching"
| "bounty_cap_reached"
```

Agregar el render correspondiente en el dropdown del `NotificationsBell`.

### 5.6 `lib/types.ts`

Extender el tipo `Bounty`:
```ts
{
  // ... campos existentes ...
  maxSubmissions: number | null;
  reviewEligibleCount: number;
}
```

---

## 6. Cambios al relayer

### 6.1 `relayer/src/submission-handler.ts`

Modificar el flujo cuando una submission termina su scoring AI y va a pasar de `pending` → `scored`:

**Pre-check**: si el bounty está `state === 'closed'` antes de scorear → no scorear, marcar submission como `auto_rejected` (sin gastar inferencia de Opus).

**Atomic UPDATE** (después del scoring, si pasa el threshold):

```ts
const result = await db.execute(sql`
  UPDATE issues
  SET review_eligible_count = review_eligible_count + 1,
      state = CASE
        WHEN bm.max_submissions IS NOT NULL
         AND issues.review_eligible_count + 1 >= bm.max_submissions
        THEN 'closed'
        ELSE issues.state
      END
  FROM bounty_meta bm
  WHERE issues.id = ${issueId}
    AND bm.issue_id = issues.id
    AND issues.state = 'open'
    AND (bm.max_submissions IS NULL
         OR issues.review_eligible_count < bm.max_submissions)
  RETURNING issues.state, issues.review_eligible_count, bm.max_submissions, bm.cap_warning_sent_at;
`);

if (result.rowCount === 0) {
  // Race lost: el bounty ya está closed o llegó al cap.
  await db.update(submissions)
    .set({ state: 'auto_rejected' })
    .where(eq(submissions.id, submissionId));
  return;
}

// Submission entra a 'scored'.
await db.update(submissions)
  .set({ state: 'scored' })
  .where(eq(submissions.id, submissionId));

const { state: newIssueState, review_eligible_count, max_submissions, cap_warning_sent_at } = result.rows[0];

// Notif al 80% (una sola vez por bounty).
if (
  max_submissions !== null &&
  cap_warning_sent_at === null &&
  review_eligible_count >= Math.ceil(max_submissions * 0.8) &&
  review_eligible_count < max_submissions
) {
  await sendCapApproachingNotif(issueId, review_eligible_count, max_submissions);
  await db.update(bountyMeta)
    .set({ capWarningSentAt: new Date() })
    .where(eq(bountyMeta.issueId, issueId));
}

// Notif al 100% (cierre automático).
if (newIssueState === 'closed') {
  await sendCapReachedNotif(issueId, max_submissions);
}
```

### 6.2 `relayer/src/db/ops.ts`

Agregar al union `RelayerNotificationKind`:
```ts
| "bounty_cap_approaching"
| "bounty_cap_reached"
```

Agregar dos helpers `sendCapApproachingNotif` y `sendCapReachedNotif` siguiendo el patrón de los existentes (`writeNotification` ya parametriza `kind` y `payload`).

---

## 7. Endpoint de creación / edición de bounty

El endpoint que persiste `bounty_meta` (al crear el bounty desde el frontend, después del éxito on-chain) debe:

1. Aceptar el nuevo campo `maxSubmissions: number | null`.
2. Validar server-side: si no es null, debe ser entero ≥ 1.
3. Persistir en `bounty_meta.max_submissions`.

El endpoint de edición debe:

1. Aplicar los guardrails de bajada (ver 5.3).
2. Si la edición sube/limpia el cap y el bounty está `closed` por cap → cambiar `state` a `'open'`.

---

## 8. Notificaciones

Dos kinds nuevos:

| Kind | Trigger | Target | Texto |
|------|---------|--------|-------|
| `bounty_cap_approaching` | `review_eligible_count >= ceil(max_submissions * 0.8)` y `cap_warning_sent_at IS NULL` | `company.user_id` | "Tu bounty {title} alcanzó el 80% del cap ({count}/{max} PRs). Considerá subir el cap si querés más opciones." |
| `bounty_cap_reached` | `state` cambia a `'closed'` por el conditional UPDATE | `company.user_id` | "Tu bounty {title} alcanzó el cap de {max} PRs y se cerró automáticamente. Revisá las submissions pendientes." |

El payload de ambas usa los campos existentes en `NotificationPayload` (`bountyTitle`, `bountyAmount`, `companyName`, `companyAvatarUrl`, `companyId`).

`cap_warning_sent_at` evita re-emitir la notif del 80% si la company sube el cap y vuelve a alcanzarse el 80% del nuevo cap. Decisión: una sola notif por bounty (mantenerlo simple). Si en el futuro se ve que conviene re-disparar, se ajusta esta lógica.

---

## 9. Testing

### 9.1 Unit tests (relayer)

En `relayer/tests/submission-handler.test.ts`:

- Submission scoreada con bounty open + sin cap → `state='scored'`, counter +1.
- Submission scoreada con `max=5` y `count=4` → `state='scored'`, counter llega a 5, bounty pasa a `closed`.
- Submission scoreada con bounty ya `closed` por cap → marca `auto_rejected`, counter no cambia.
- Race condition (dos UPDATEs concurrentes con `count=max-1`) → uno gana, otro queda `auto_rejected`.
- Submission `auto_rejected` por threshold → counter NO incrementa.
- Notif `cap_approaching` se emite una sola vez (chequeo del flag `cap_warning_sent_at`).
- Notif `cap_reached` se emite cuando state pasa a `closed`.

### 9.2 Tests de migración

Antes/después de aplicar la migración:

- `submission_count` de las 3 bounties existentes mantiene su valor.
- `review_eligible_count` queda correctamente backfilleado contando submissions `scored`+`winner` por bounty.
- Bounty con `release_mode='auto'` queda en `'assisted'`.
- Default de `release_mode` queda en `'assisted'`.
- `max_submissions` queda `null` para todas las existentes.

### 9.3 Testing manual (browser)

Con localhost levantado:

- Crear bounty sin cap → bounty creado OK, sin badge "Cap reached".
- Crear bounty con `max=2` → enviar 2 PRs desde una cuenta dev de test → bounty pasa a `closed` automáticamente, badge cambia.
- Editar bounty existente: subir cap → OK. Bajar cap por debajo de count actual → input rojo, no permite guardar.
- Reabrir bounty cerrado por cap subiendo el cap → vuelve a `state=open`.
- Validación amount: pegar texto en input → no debe entrar. Pegar "0.5" → entra. Pegar "abc" → no entra.
- Validación max submissions: pegar "0.5" → no debe entrar. Pegar "abc" → no entra.

### 9.4 No-scope

No vamos a configurar tests E2E automatizados (Playwright/Cypress) en este alcance — el repo no los tiene para flows de bounty hoy. Testing manual + unit tests del relayer son suficientes para MVP.

---

## 10. Out of scope

- **Cap on-chain** (programa Anchor). Documentado como tech debt en `docsGaso/tech-debt.md`. Implica redeploy del programa y migración de PDAs. Riesgo aceptado: PDAs huérfanas creadas por firma directa de `submit_solution` (ataque cuesta ~$0.40 sin resultado útil).
- **Rediseño visual** del form (fonts, colors, spacing).
- **Cambios al sistema de scoring AI** o al `reject_threshold` en sí.
- **Edición masiva de `max_submissions`** desde un dashboard de admin.
- **Endpoint público** para que devs sepan el cap antes de abrir el PR en GitHub (queda como info visible solo en la app).

---

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Migración SQL en DB compartida (no hay staging) | El user está al tanto. Migración es aditiva (solo ALTER ADD + UPDATE de 1 fila). Backup manual antes de aplicar. |
| Cambio de la columna `submission_count` → ahora coexiste con `review_eligible_count` | Decisión deliberada: mantener `submission_count` con su semántica original ("todas las submissions"). El cap usa solo `review_eligible_count`. |
| PDAs huérfanas on-chain | Aceptado en MVP. Loguear en watcher si se detecta volumen significativo para revisitar. |
| Race condition en conditional UPDATE | Cubierto por el atomicity de Postgres (row lock). Si dos updates concurrentes, uno gana, otro marca submission como `auto_rejected`. Test específico. |
| Notif `cap_approaching` se emite tarde (ej. cap=3 → 80% es 2.4, ceil=3 = mismo que cap_reached) | Aceptado. Para caps muy chicos (≤4) la notif del 80% efectivamente coincide con el 100%. No vale la pena hacer lógica especial. |
| User pone `max_submissions=1` (caso límite) | Permitido. El primer PR scoreado cierra el bounty. Comportamiento esperable y útil para bounties de "first-come-first-served". |

---

## 12. Criterios de aceptación

- [ ] El input "Bounty amount" no permite letras ni signos no-numéricos (ni typing ni paste).
- [ ] El form de creación ya no muestra el `<ReleaseModePicker>`.
- [ ] Bounties nuevos se crean con `release_mode='assisted'`.
- [ ] El bounty existente con `release_mode='auto'` quedó migrado a `'assisted'`.
- [ ] Default de `bounty_meta.release_mode` es `'assisted'`.
- [ ] El campo "Max PRs to review (optional)" aparece después de "Reject threshold" y antes de "Evaluation criteria".
- [ ] El campo guarda `null` si está vacío y un entero ≥ 1 si tiene valor.
- [ ] El relayer rechaza submission #N+1 cuando `max_submissions=N` (race condition cubierta).
- [ ] Al alcanzar el cap, el bounty pasa a `state='closed'` automáticamente, en la misma transacción.
- [ ] Dev side: botón "Submit PR" deshabilitado en bounty cap-reached, con tooltip explicativo.
- [ ] Badge "Cap reached" visible en `BountyRow` para bounties cerrados por cap.
- [ ] La company puede subir el cap libremente; bajar solo si nuevo ≥ count actual.
- [ ] Reabrir bounty cerrado por cap subiendo el cap → `state` vuelve a `'open'`.
- [ ] Notif `bounty_cap_approaching` llega a la company al 80% del cap (una sola vez).
- [ ] Notif `bounty_cap_reached` llega a la company cuando el bounty se cierra por cap.
- [ ] Unit tests del relayer cubren los 7 casos listados en 9.1.
- [ ] Migración no rompe los 3 bounties existentes.
