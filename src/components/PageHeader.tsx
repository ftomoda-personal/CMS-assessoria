import type { ReactNode } from "react";

export function PageHeader({ title, description, actions, className = "" }: { title: string; description?: string; actions?: ReactNode; className?: string }) {
  return <header className={`page-header ${className}`}><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions}</header>;
}
