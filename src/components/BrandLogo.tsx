import logoUrl from "../assets/logo.jpg";

type Props = {
  className?: string;
  size?: number;
};

export function BrandLogo({ className = "brand-mark", size = 36 }: Props) {
  return (
    <img
      src={logoUrl}
      alt="Пятёрка"
      width={size}
      height={size}
      className={className}
      decoding="async"
    />
  );
}
