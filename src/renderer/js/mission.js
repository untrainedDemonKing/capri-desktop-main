// Today's mission log: what Claude got through today, for her report card (from her menu, or
// on her own in the evening). One day at a time, in this machine's storage; the demo doesn't count.

import { today } from './util.js';

const KEY = 'capri.mission';

const blank = () => ({
  date: today(),
  prompts: 0,
  missions: 0,  // tasks Claude finished
  actions: 0,
  files: 0,     // files changed, summed over the missions
  errors: 0,
  approvals: 0, // times it needed your permission
  longest: null, // { ms, project }
  projects: [],
  reported: false, // she already brought it to you on her own today
});

export class Mission {
  constructor() {
    this.data = blank();
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved?.date === today()) this.data = { ...this.data, ...saved };
    } catch {
      // no storage: today starts from zero
    }
  }

  // the day so far (a new day starts a new log)
  get day() {
    if (this.data.date !== today()) this.data = blank();
    return this.data;
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // nothing to do: it lives for this run only
    }
  }

  prompt(project) {
    const d = this.day;
    d.prompts += 1;
    if (project && !d.projects.includes(project)) d.projects.push(project);
    this.save();
  }

  action() {
    this.day.actions += 1;
    // a burst of tool calls doesn't need a write each
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 2000);
  }

  error() {
    this.day.errors += 1;
    this.save();
  }

  approval() {
    this.day.approvals += 1;
    this.save();
  }

  done({ files = 0, ms = 0, project = '' }) {
    const d = this.day;
    d.missions += 1;
    d.files += files;
    if (ms && (!d.longest || ms > d.longest.ms)) d.longest = { ms, project };
    this.save();
  }

  markReported() {
    this.day.reported = true;
    this.save();
  }
}
