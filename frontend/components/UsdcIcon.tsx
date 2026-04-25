/* eslint-disable @next/next/no-img-element */

export function UsdcIcon({ size = 18 }: { size?: number }) {
  return (
    <img
      src="/assets/usdc.svg"
      alt="USDC"
      className="usdc-icon"
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  );
}
