import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";

type Kind = "line" | "section" | "item" | "channel";

interface RawNode {
  id: string;
  parent_id: string | null;
  kind: Kind;
  title: string;
  sort_order: number;
}

interface RawAttachment {
  id: string;
  submission_id: string;
  kind: "file" | "link" | "text";
  file_url: string | null;
  file_name: string | null;
  link_url: string | null;
  text_body: string | null;
  size_bytes: number | null;
  created_at: string;
}

interface RawSubmission {
  id: string;
  node_id: string;
  version_number: number;
  uploaded_by: string;
  uploaded_at: string;
  decision: "go" | "no_go" | null;
  decided_by: string | null;
  decided_at: string | null;
  feedback: string | null;
}

interface RawMessage {
  id: string;
  node_id: string;
  submission_id: string | null;
  author_email: string;
  author_role: "owner" | "rep" | "admin";
  body: string;
  created_at: string;
}

interface ThreadMessage {
  id: string;
  body: string;
  author_email: string;
  author_role: "owner" | "rep" | "admin";
  submission_id: string | null;
  created_at: string;
}

interface Version {
  id: string;
  version_number: number;
  uploaded_by: string;
  uploaded_at: string;
  decision: "go" | "no_go" | "pending";
  decided_by: string | null;
  decided_at: string | null;
  feedback: string | null;
  attachments: RawAttachment[];
}

interface LeafOut {
  id: string;
  title: string;
  isLeaf: true;
  latestSubmission: Version | null;
  versions: Version[];
  decision: "go" | "no_go" | "pending";
  locked: boolean;
  messages: ThreadMessage[];
}

interface ItemOut {
  id: string;
  title: string;
  isLeaf: boolean;
  channels?: LeafOut[];
  latestSubmission?: Version | null;
  versions?: Version[];
  decision?: "go" | "no_go" | "pending";
  locked?: boolean;
  messages?: ThreadMessage[];
  rollup: { totalLeaves: number; goLeaves: number; percent: number };
}

interface SectionOut {
  id: string;
  title: string;
  items: ItemOut[];
  rollup: { totalLeaves: number; goLeaves: number; percent: number };
}

interface LineOut {
  id: string;
  title: string;
  sections: SectionOut[];
  rollup: { totalLeaves: number; goLeaves: number; percent: number };
}

export async function GET(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);

  const sb = createServiceClient();

  const [nodesRes, submissionsRes, attachmentsRes, messagesRes] = await Promise.all([
    sb.from("campaign_nodes").select("*").order("sort_order", { ascending: true }),
    sb.from("campaign_submissions").select("*").order("version_number", { ascending: true }),
    sb.from("campaign_submission_attachments").select("*").order("created_at", { ascending: true }),
    sb.from("campaign_thread_messages").select("*").order("created_at", { ascending: true }),
  ]);

  if (nodesRes.error) return err(nodesRes.error.message, 500);
  if (submissionsRes.error) return err(submissionsRes.error.message, 500);
  if (attachmentsRes.error) return err(attachmentsRes.error.message, 500);
  if (messagesRes.error) return err(messagesRes.error.message, 500);

  const nodes = (nodesRes.data as RawNode[]) || [];
  const submissions = (submissionsRes.data as RawSubmission[]) || [];
  const attachments = (attachmentsRes.data as RawAttachment[]) || [];
  const rawMessages = (messagesRes.data as RawMessage[]) || [];

  const messagesByNode = new Map<string, ThreadMessage[]>();
  for (const m of rawMessages) {
    const entry: ThreadMessage = {
      id: m.id,
      body: m.body,
      author_email: m.author_email,
      author_role: m.author_role,
      submission_id: m.submission_id,
      created_at: m.created_at,
    };
    const list = messagesByNode.get(m.node_id) || [];
    list.push(entry);
    messagesByNode.set(m.node_id, list);
  }

  // Index attachments by submission id
  const attachmentsBySub = new Map<string, RawAttachment[]>();
  for (const a of attachments) {
    const list = attachmentsBySub.get(a.submission_id) || [];
    list.push(a);
    attachmentsBySub.set(a.submission_id, list);
  }

  // Group submissions by node id
  const versionsByNode = new Map<string, Version[]>();
  for (const s of submissions) {
    const v: Version = {
      id: s.id,
      version_number: s.version_number,
      uploaded_by: s.uploaded_by,
      uploaded_at: s.uploaded_at,
      decision: s.decision ?? "pending",
      decided_by: s.decided_by,
      decided_at: s.decided_at,
      feedback: s.feedback,
      attachments: attachmentsBySub.get(s.id) || [],
    };
    const list = versionsByNode.get(s.node_id) || [];
    list.push(v);
    versionsByNode.set(s.node_id, list);
  }

  // Build parent->children index
  const childrenByParent = new Map<string, RawNode[]>();
  for (const n of nodes) {
    const key = n.parent_id ?? "__root__";
    const list = childrenByParent.get(key) || [];
    list.push(n);
    childrenByParent.set(key, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order);
  }

  const leafFor = (node: RawNode): LeafOut => {
    const versions = versionsByNode.get(node.id) || [];
    const latest = versions.length > 0 ? versions[versions.length - 1] : null;
    const decision: "go" | "no_go" | "pending" = latest ? latest.decision : "pending";
    return {
      id: node.id,
      title: node.title,
      isLeaf: true,
      latestSubmission: latest,
      versions,
      decision,
      locked: decision === "go",
      messages: messagesByNode.get(node.id) || [],
    };
  };

  const itemFor = (node: RawNode): ItemOut => {
    const children = childrenByParent.get(node.id) || [];
    const channelNodes = children.filter((c) => c.kind === "channel");
    if (channelNodes.length > 0) {
      const channels = channelNodes.map(leafFor);
      const totalLeaves = channels.length;
      const goLeaves = channels.filter((c) => c.decision === "go").length;
      return {
        id: node.id,
        title: node.title,
        isLeaf: false,
        channels,
        rollup: {
          totalLeaves,
          goLeaves,
          percent: totalLeaves === 0 ? 0 : Math.round((goLeaves / totalLeaves) * 100),
        },
      };
    }
    const leaf = leafFor(node);
    return {
      id: node.id,
      title: node.title,
      isLeaf: true,
      latestSubmission: leaf.latestSubmission,
      versions: leaf.versions,
      decision: leaf.decision,
      locked: leaf.locked,
      messages: leaf.messages,
      rollup: {
        totalLeaves: 1,
        goLeaves: leaf.decision === "go" ? 1 : 0,
        percent: leaf.decision === "go" ? 100 : 0,
      },
    };
  };

  const sectionFor = (node: RawNode): SectionOut => {
    const items = (childrenByParent.get(node.id) || []).map(itemFor);
    const totalLeaves = items.reduce((a, i) => a + i.rollup.totalLeaves, 0);
    const goLeaves = items.reduce((a, i) => a + i.rollup.goLeaves, 0);
    return {
      id: node.id,
      title: node.title,
      items,
      rollup: {
        totalLeaves,
        goLeaves,
        percent: totalLeaves === 0 ? 0 : Math.round((goLeaves / totalLeaves) * 100),
      },
    };
  };

  const lines: LineOut[] = (childrenByParent.get("__root__") || [])
    .filter((n) => n.kind === "line")
    .map((lineNode) => {
      const sections = (childrenByParent.get(lineNode.id) || []).map(sectionFor);
      const totalLeaves = sections.reduce((a, s) => a + s.rollup.totalLeaves, 0);
      const goLeaves = sections.reduce((a, s) => a + s.rollup.goLeaves, 0);
      return {
        id: lineNode.id,
        title: lineNode.title,
        sections,
        rollup: {
          totalLeaves,
          goLeaves,
          percent: totalLeaves === 0 ? 0 : Math.round((goLeaves / totalLeaves) * 100),
        },
      };
    });

  return ok(lines);
}
