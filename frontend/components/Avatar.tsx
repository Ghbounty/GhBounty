/* eslint-disable @next/next/no-img-element */
import type { CSSProperties } from "react";

export function Avatar({
  src,
  name,
  size = 40,
  rounded = true,
}: {
  src?: string;
  name: string;
  size?: number;
  rounded?: boolean;
}) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: rounded ? size / 2 : Math.max(6, size * 0.18),
  };

  if (src) {
    return (
      <img
        className="avatar avatar-img"
        src={src}
        alt={name}
        style={style}
      />
    );
  }
  return (
    <div className="avatar avatar-fallback" style={style}>
      <span style={{ fontSize: Math.round(size * 0.38) }}>{initials || "?"}</span>
    </div>
  );
}
