import { redirect } from "next/navigation";

export default async function OutlinePage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/articles/${id}?step=outline`);
}
