import type { SVGProps } from "react";

/**
 * Block-P mark for Praxis. Renders the P letterform as an inline SVG.
 * Use `color` (or CSS `color`) to tint and `size` to set the height in px.
 */

const BRAND_BLUE = "#4f46e5";

type PraxisLogoProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  size?: number;
  /** Fill color – defaults to currentColor so it inherits from text color */
  color?: string;
};

export function PraxisLogo({
  size = 24,
  color = "currentColor",
  className,
  ...rest
}: PraxisLogoProps) {
  // The P mark viewBox is 18 wide x 32 tall.
  // Width scales proportionally from the given height.
  const width = (size * 18) / 32;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={size}
      viewBox="0 0 18 32"
      fill={color}
      className={className}
      role="img"
      aria-label="Praxis"
      {...rest}
    >
      <path
        fillRule="evenodd"
        d="M1 1h8a7 7 0 0 1 0 14v16H1V1zm8 3.5a3.5 3.5 0 0 1 0 7V4.5z"
      />
    </svg>
  );
}

export { BRAND_BLUE };
