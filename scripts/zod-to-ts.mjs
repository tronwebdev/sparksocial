/**
 * A Zod → TypeScript printer, for `generate-tool-types.mjs`.
 *
 * ── Why not a dependency ──────────────────────────────────────────────────
 *
 * `zod-to-ts` exists. It also throws on constructs it does not model, which is
 * the wrong failure for 205 schemas written without it in mind: one unusual
 * tool would take the whole generation down. This prints what it understands
 * and emits `unknown` for anything else, recording it so the generator can
 * report coverage instead of silently producing `any`.
 *
 * `unknown` is the important half of that: a caller handed `unknown` has to
 * narrow it, so an unconverted schema is inconvenient rather than unsound. The
 * one thing this must never emit is `any`.
 *
 * ── Input and output are printed differently ─────────────────────────────
 *
 * Two rules diverge by direction:
 *
 *   `.default(v)`  on **input** makes a field optional — the caller may omit it
 *                  and the server fills it in. On **output** it makes the field
 *                  *guaranteed* — the value has already been through the
 *                  schema, so the default is present.
 *
 *   `z.date()`     is a `Date` on the server and a **string** by the time a
 *                  browser sees it, because it went through `JSON.stringify`.
 *                  Printing `Date` here would reproduce a bug this repo has
 *                  already had (`e603b67`, "A Date that has been through JSON
 *                  is a string, and it took a tab down"). So dates print as
 *                  `string` in both directions: that is what the wire carries.
 */

/** Zod's own discriminator, stable across 3.x. */
const t = (schema) => schema?._def?.typeName;

const QUOTE_SAFE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const key = (k) => (QUOTE_SAFE.test(k) ? k : JSON.stringify(k));

/**
 * @param schema a Zod schema
 * @param mode `'input'` or `'output'` — see the header
 * @param ctx `{ unknowns: string[], path: string[] }` for coverage reporting
 * @param depth guards against a `z.lazy` cycle printing forever
 */
export function print(schema, mode, ctx, depth = 0) {
  if (!schema || depth > 12) return note(ctx, 'depth/empty');

  const kind = t(schema);
  const d = schema._def;

  switch (kind) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
    case 'ZodBigInt':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    /* See the header: a Date on the wire is a string. */
    case 'ZodDate':
      return 'string';
    case 'ZodNull':
      return 'null';
    case 'ZodUndefined':
    case 'ZodVoid':
      return 'undefined';
    case 'ZodAny':
    case 'ZodUnknown':
      return 'unknown';
    case 'ZodNever':
      return 'never';

    case 'ZodLiteral':
      return JSON.stringify(d.value);

    case 'ZodEnum':
      return d.values.map((v) => JSON.stringify(v)).join(' | ');

    case 'ZodNativeEnum':
      return Object.values(d.values)
        .filter((v) => typeof v !== 'number')
        .map((v) => JSON.stringify(v))
        .join(' | ') || 'string';

    case 'ZodArray':
      return `Array<${print(d.type, mode, ctx, depth + 1)}>`;

    case 'ZodSet':
      return `Array<${print(d.valueType, mode, ctx, depth + 1)}>`;

    case 'ZodTuple':
      return `[${d.items.map((i) => print(i, mode, ctx, depth + 1)).join(', ')}]`;

    case 'ZodRecord':
      return `Record<${print(d.keyType, mode, ctx, depth + 1)}, ${print(d.valueType, mode, ctx, depth + 1)}>`;

    case 'ZodMap':
      return `Record<string, ${print(d.valueType, mode, ctx, depth + 1)}>`;

    case 'ZodObject': {
      const shape = d.shape();
      const fields = Object.entries(shape).map(([k, v]) => {
        const optional = isOptional(v, mode);
        const inner = unwrapForOptional(v, mode);
        ctx.path.push(k);
        const printed = print(inner, mode, ctx, depth + 1);
        ctx.path.pop();
        return `${key(k)}${optional ? '?' : ''}: ${printed}`;
      });
      if (fields.length === 0) return 'Record<string, never>';
      return `{ ${fields.join('; ')} }`;
    }

    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = d.options instanceof Map ? [...d.options.values()] : d.options;
      return options.map((o) => `(${print(o, mode, ctx, depth + 1)})`).join(' | ');
    }

    case 'ZodIntersection':
      return `(${print(d.left, mode, ctx, depth + 1)} & ${print(d.right, mode, ctx, depth + 1)})`;

    /* Wrappers that do not change the printed type. */
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodReadonly':
    case 'ZodBranded':
      return print(d.innerType ?? d.type, mode, ctx, depth + 1);

    /**
     * `.refine`/`.superRefine` keep the shape; `.transform` does not, and there
     * is no way to know the result type from the schema. Printing the input
     * shape would be a guess, so a transform reports itself.
     */
    case 'ZodEffects':
      return d.effect?.type === 'transform'
        ? note(ctx, 'transform')
        : print(d.schema, mode, ctx, depth + 1);

    case 'ZodPipeline':
      return print(mode === 'input' ? d.in : d.out, mode, ctx, depth + 1);

    case 'ZodLazy':
      try {
        return print(d.getter(), mode, ctx, depth + 1);
      } catch {
        return note(ctx, 'lazy');
      }

    default:
      return note(ctx, kind ?? 'unrecognised');
  }
}

/** Records an unconverted spot and yields the only safe placeholder. */
function note(ctx, why) {
  ctx.unknowns.push(`${ctx.path.join('.') || '(root)'}: ${why}`);
  return 'unknown';
}

/**
 * Whether a field may be omitted.
 *
 * `.optional()` always. `.default()` only on the way *in* — on the way out the
 * schema has already run and the value is there.
 */
function isOptional(schema, mode) {
  const kind = t(schema);
  if (kind === 'ZodOptional') return true;
  if (kind === 'ZodDefault') return mode === 'input';
  /* `.nullable()` is not optional: the key is present and holds null. */
  if (kind === 'ZodEffects' && schema._def.effect?.type !== 'transform') {
    return isOptional(schema._def.schema, mode);
  }
  return false;
}

/**
 * Strips the wrapper an optional field is wearing, so `{ a?: string }` comes
 * out rather than `{ a?: string | undefined }` — and keeps `| null` where
 * `.nullable()` genuinely allows it.
 */
function unwrapForOptional(schema, mode) {
  const kind = t(schema);
  if (kind === 'ZodOptional') return schema._def.innerType;
  if (kind === 'ZodDefault' && mode === 'input') return schema._def.innerType;
  if (kind === 'ZodNullable') {
    return { _def: { typeName: 'ZodUnion', options: [schema._def.innerType, { _def: { typeName: 'ZodNull' } }] } };
  }
  return schema;
}
