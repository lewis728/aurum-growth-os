import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import AddClientChatWrapper from "./AddClientChatWrapper";

export default async function AddClientPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/setup-org");
  return <AddClientChatWrapper />;
}
