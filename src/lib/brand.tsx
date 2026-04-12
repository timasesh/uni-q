/** `public/scheme/logo.png` */
export const APP_LOGO_SRC = "/scheme/logo.png";

export function AppLogo({ className, alt = "uni-q" }: { className?: string; alt?: string }) {
  return <img src={APP_LOGO_SRC} alt={alt} className={className} loading="lazy" decoding="async" />;
}
