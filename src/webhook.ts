// src/webhook.ts

export async function sendWebhook(
  webhookUrl: string,
  content: string
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // allowed_mentions: チャンネル名等に @everyone / @here / ロールメンションが
    // 含まれていても通知が発火しないようにする
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Failed to send webhook", res.status, text);
    throw new Error(`Webhook error: ${res.status}`);
  }
}
