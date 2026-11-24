export interface OutlineNode {
  id: string;
  level: number;
  text: string;
  displayText?: string;
  line: number;
  pos: number;
  children: OutlineNode[];
  parentId: string | null;
}

export function buildOutlineTree(
  outline: {
    level: number;
    text: string;
    displayText?: string;
    line: number;
    pos?: number;
  }[],
): OutlineNode[] {
  const rootNodes: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  outline.forEach((item, index) => {
    const node: OutlineNode = {
      level: item.level,
      text: item.text,
      ...(item.displayText !== undefined
        ? { displayText: item.displayText }
        : {}),
      line: item.line,
      pos: item.pos ?? 0,
      id: `outline-${index}`,
      children: [],
      parentId: null,
    };

    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
      stack.pop();
    }

    if (stack.length > 0) {
      const parent = stack[stack.length - 1];
      node.parentId = parent.id;
      parent.children.push(node);
    } else {
      rootNodes.push(node);
    }

    stack.push(node);
  });

  return rootNodes;
}

export function getAllExpandableIds(nodes: OutlineNode[]): string[] {
  const ids: string[] = [];
  const traverse = (nodeList: OutlineNode[]) => {
    nodeList.forEach((node) => {
      if (node.children.length > 0) {
        ids.push(node.id);
        traverse(node.children);
      }
    });
  };
  traverse(nodes);
  return ids;
}
