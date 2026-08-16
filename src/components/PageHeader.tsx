import type { ReactNode } from "react";

type Props = {
  title: string;
  sub?: string;
  actions?: ReactNode;
};

export function PageHeader({ title, sub, actions }: Props) {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}
