declare module 'punycode.js' {
  function toUnicode(input: string): string;
  function toASCII(input: string): string;

  export { toUnicode, toASCII };
  export default { toUnicode, toASCII };
}
