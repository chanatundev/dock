import dockIconUrl from "../../../desktop/resources/branding/dock-renderer.png";

export function DesktopBrandMark({ className }: { readonly className?: string }) {
  return <img src={dockIconUrl} alt="" className={className} aria-hidden />;
}
