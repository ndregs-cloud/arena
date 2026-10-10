"use client";

import { useState } from "react";

/**
 * Stepper kuantitas. Nilai tetap ditulis ke input `name` sehingga form server berjalan tanpa JS;
 * tombol +/- hanya kenyamanan dan tidak pernah melampaui max/min yang dihitung server.
 */
export function QuantityInput({
  name,
  value = 1,
  min = 1,
  max = 99,
  id,
  label = "Jumlah",
  onChange,
}: {
  name: string;
  value?: number;
  min?: number;
  max?: number;
  id: string;
  label?: string;
  onChange?: (value: number) => void;
}) {
  const [current, setCurrent] = useState(Math.min(max, Math.max(min, value)));
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const set = (next: number) => {
    const safe = clamp(next);
    setCurrent(safe);
    onChange?.(safe);
  };
  const atMax = current >= max;
  const atMin = current <= min;

  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-control border border-border bg-surface">
      <button
        type="button"
        onClick={() => set(current - 1)}
        disabled={atMin}
        aria-label={`Kurangi ${label.toLowerCase()}`}
        className="w-11 min-h-[44px] text-[18px] font-bold text-ink-soft hover:bg-canvas disabled:opacity-40"
      >
        −
      </button>
      <input
        id={id}
        name={name}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={current}
        onChange={(event) => set(Number(event.target.value) || min)}
        aria-label={label}
        aria-describedby={`${id}-bounds`}
        className="tnum w-14 border-x border-border text-center text-[15px] font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
      />
      <button
        type="button"
        onClick={() => set(current + 1)}
        disabled={atMax}
        aria-label={`Tambah ${label.toLowerCase()}`}
        className="w-11 min-h-[44px] text-[18px] font-bold text-ink-soft hover:bg-canvas disabled:opacity-40"
      >
        +
      </button>
      <span id={`${id}-bounds`} className="sr-only">
        Minimum {min}, maksimum {max}.
      </span>
    </div>
  );
}
