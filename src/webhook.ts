// src/webhook.ts

export async function sendWebhook(
  webhookUrl: string,
  content: string
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Failed to send webhook", res.status, text);
    throw new Error(`Webhook error: ${res.status}`);
  }
}
