"use client";

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 font-bold">{label}</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={`min-h-12 min-w-14 rounded-xl border-2 px-4 font-bold transition ${
                on ? "border-cyan bg-cyan text-stage" : "border-line bg-stage text-ink hover:border-violet"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  description,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-14 w-full items-center justify-between gap-4 rounded-2xl border-2 border-line bg-stage px-4 py-2 text-left disabled:opacity-50"
    >
      <span>
        <span className="block font-bold">{label}</span>
        {description && <span className="block text-sm text-mute">{description}</span>}
      </span>
      <span
        aria-hidden
        className={`relative h-8 w-14 shrink-0 rounded-full transition ${checked ? "bg-lime" : "bg-line"}`}
      >
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${checked ? "left-7" : "left-1"}`} />
      </span>
    </button>
  );
}
