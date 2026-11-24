declare module 'css-tree' {
  export interface CssNode {
    type: string
    [key: string]: any
  }
  export interface Rule extends CssNode {
    type: 'Rule'
    prelude: CssNode
    block: Block
  }
  export interface Atrule extends CssNode {
    type: 'Atrule'
    name: string
    prelude?: CssNode
    block?: Block
  }
  export interface Raw extends CssNode {
    type: 'Raw'
    value: string
  }
  export interface Declaration extends CssNode {
    type: 'Declaration'
    property: string
    value: CssNode
    important: boolean
  }
  export interface Block extends CssNode {
    type: 'Block'
    children: List<CssNode>
  }
  export interface StyleSheet extends CssNode {
    type: 'StyleSheet'
    children: List<CssNode>
  }
  export interface List<T> {
    head: ListNode<T> | null
    tail: ListNode<T> | null
    isEmpty: boolean
    size: number
    toArray(): T[]
    forEach(callback: (data: T, item?: ListNode<T>) => void): void
    createItem(data: T): ListNode<T>
    appendData(data: T): void
    replace(oldItem: ListNode<T>, newItem: ListNode<T>): void
  }
  export interface ListNode<T> {
    prev: ListNode<T> | null
    next: ListNode<T> | null
    data: T
  }
  export function parse(css: string): StyleSheet
  export function parse(css: string, options: { context: string }): CssNode
  // 通用解析选项（放在 { context } 重载之后：theme-css-parser 的
  // `parse(css, { context: 'declaration' })` 仍解析为 CssNode，无回归）。
  export function parse(
    css: string,
    options: {
      parseValue?: boolean
      parseCustomProperty?: boolean
      onParseError?: (error: unknown) => void
    }
  ): StyleSheet
  export function generate(node: CssNode): string
  export function walk(
    node: CssNode,
    options: {
      visit?: string
      enter?: (node: any, item?: any, list?: any) => void
      leave?: (node: any, item?: any, list?: any) => void
    }
  ): void
  export const List: {
    createItem<T>(data: T): ListNode<T>
  }
}
