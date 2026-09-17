import type { ReactNode } from "react";
import Link from "next/link";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="知文首页">
          <span className="brand-mark" aria-hidden="true">知</span>
          <span>知文</span>
        </Link>
        <nav aria-label="主导航">
          <Link className="nav-link" href="/">文章</Link>
          <Link className="nav-link" href="/settings">设置</Link>
        </nav>
      </header>
      <main className="main-content">{children}</main>
    </div>
  );
}
