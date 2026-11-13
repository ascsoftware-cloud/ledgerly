import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/states/page-skeleton";
import { ExpenseForm } from "@/features/expenses/components/expense-form";
import { isVatRegistered, listCategories } from "@/features/expenses/queries";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Log an expense", robots: { index: false } };

export default function NewExpensePage({ params }: PageProps<"/[ws]/money/expenses/new">) {
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <NewExpense params={params} />
    </Suspense>
  );
}

async function NewExpense({ params }: { params: PageProps<"/[ws]/money/expenses/new">["params"] }) {
  const { ws } = await params;
  const ctx = await requireWorkspace(ws);
  if (ctx.role === "accountant") notFound();
  const [categories, vatRegistered] = await Promise.all([listCategories(ctx), isVatRegistered(ctx)]);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/${ws}/money/expenses`} className="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Expenses
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Log an expense</h1>
      <ExpenseForm slug={ws} categories={categories} canRepeat={ctx.role === "owner" || ctx.role === "admin"} vatRegistered={vatRegistered} />
    </div>
  );
}
