"use client";
import { useRouter } from "next/navigation";
import AddClientChat from "@/components/clients/AddClientChat";

export default function AddClientChatWrapper() {
  const router = useRouter();
  return (
    <AddClientChat
      onClientAdded={(blueprintId) => {
        router.push(`/?newClient=${blueprintId}`);
      }}
      onCancel={() => router.push("/")}
    />
  );
}
