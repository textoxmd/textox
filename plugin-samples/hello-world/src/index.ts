import { Plugin, type SettingsField } from '@textox/plugin-sdk';

import './styles.css';

export default class HelloWorldPlugin extends Plugin {
  static settingsFields: SettingsField[] = [
    { key: 'greeting', type: 'text', default: 'Hello', labelKey: 'greeting' },
    { key: 'shout', type: 'boolean', default: false, labelKey: 'shout' },
  ];

  onload(): void {
    this.addCommand({
      id: 'app.textox.hello-world.say',
      name: 'Hello: say greeting',
      callback: () => {
        const greeting = this.settings.get<string>('greeting') ?? 'Hello';
        const text = this.settings.get<boolean>('shout') ? greeting.toUpperCase() : greeting;
        this.app.toast.success(text);
        this.app.log.info('greeting sent', text);
      },
    });
  }
}
