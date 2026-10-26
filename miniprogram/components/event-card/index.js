Component({
  properties: { event: { type: Object, value: {} } },
  methods: { select() { this.triggerEvent('select', { id: this.data.event.id, status: this.data.event.status }); } },
  options: { styleIsolation: 'apply-shared' }
});
