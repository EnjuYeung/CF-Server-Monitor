import assert from 'node:assert/strict';
import test from 'node:test';
import { nextListSort, sortListServers, readListSortPreference, writeListSortPreference } from '../src/frontend/utils/listSort.js';
import { STORAGE } from '../src/frontend/utils/constants.js';

const ids = servers => servers.map(server => server.id);

test('列表排序按自然数比较主机名，忽略大小写，同值保留默认顺序且不修改输入', () => {
  const servers = Object.freeze([
    { id: 'ten', name: 'node10' }, { id: 'two-upper', name: 'NODE2' },
    { id: 'two-lower', name: 'node2' }, { id: 'one', name: 'node1' }
  ].map(Object.freeze));
  assert.deepEqual(ids(sortListServers(servers, { key: 'name', direction: 'asc' })), ['one', 'two-upper', 'two-lower', 'ten']);
  assert.deepEqual(ids(sortListServers(servers, { key: 'name', direction: 'desc' })), ['ten', 'two-upper', 'two-lower', 'one']);
  assert.deepEqual(ids(servers), ['ten', 'two-upper', 'two-lower', 'one']);
  assert.deepEqual(ids(sortListServers(servers, null)), ids(servers));
});

test('列表主机名的中文按拼音排序', () => {
  const servers = ['上海', '重庆', '北京', '广州'].map(name => ({ name, id: name }));
  assert.deepEqual(ids(sortListServers(servers, { key: 'name', direction: 'asc' })), ['北京', '重庆', '广州', '上海']);
  assert.deepEqual(ids(sortListServers(servers, { key: 'name', direction: 'desc' })), ['上海', '广州', '重庆', '北京']);
});

test('列表地区按大写代码排列，同地区和未知地区保留默认顺序，未知地区双向置底', () => {
  const servers = [
    { id: 'us1', region: 'us' }, { id: 'empty', region: '' }, { id: 'cn1', region: 'CN' },
    { id: 'xx', region: ' xx ' }, { id: 'us2', region: 'US' }, { id: 'missing' },
    { id: 'jp', region: 'JP' }, { id: 'cn2', region: 'cn' }, { id: 'custom', region: 'CN-2' }
  ];
  assert.deepEqual(ids(sortListServers(servers, { key: 'region', direction: 'asc' })),
    ['cn1', 'cn2', 'custom', 'jp', 'us1', 'us2', 'empty', 'xx', 'missing']);
  assert.deepEqual(ids(sortListServers(servers, { key: 'region', direction: 'desc' })),
    ['us1', 'us2', 'jp', 'custom', 'cn1', 'cn2', 'empty', 'xx', 'missing']);
});

test('点击列头在升序、降序与默认间循环，切换列重新从升序开始', () => {
  const ascending = nextListSort(null, 'name');
  assert.deepEqual(ascending, { key: 'name', direction: 'asc' });
  const descending = nextListSort(ascending, 'name');
  assert.deepEqual(descending, { key: 'name', direction: 'desc' });
  assert.equal(nextListSort(descending, 'name'), null);
  assert.deepEqual(nextListSort(descending, 'region'), { key: 'region', direction: 'asc' });
  assert.deepEqual(nextListSort(nextListSort(null, 'region'), 'region'), { key: 'region', direction: 'desc' });
});

test('浏览器记住列表排序，恢复默认时清除偏好，无效偏好回退默认', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key)
  } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
  assert.equal(readListSortPreference(), null);
  for (const key of ['name', 'region']) {
    for (const direction of ['asc', 'desc']) {
      writeListSortPreference({ key, direction });
      assert.deepEqual(readListSortPreference(), { key, direction });
    }
  }
  writeListSortPreference(null);
  assert.equal(data.has(STORAGE.LIST_SORT_PREFERENCE), false);
  for (const raw of ['not json', 'null', '[]', '"name"', '{"key":"cpu","direction":"asc"}', '{"key":"name","direction":"sideways"}']) {
    data.set(STORAGE.LIST_SORT_PREFERENCE, raw);
    assert.equal(readListSortPreference(), null, raw);
  }
});

test('浏览器拒绝存储访问时仍可切换和执行列表排序', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage unavailable'); } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
  assert.equal(readListSortPreference(), null);
  const sort = nextListSort(null, 'name');
  assert.doesNotThrow(() => writeListSortPreference(sort));
  assert.doesNotThrow(() => writeListSortPreference(null));
  assert.deepEqual(ids(sortListServers([{ id: 'two', name: 'n2' }, { id: 'one', name: 'n1' }], sort)), ['one', 'two']);
});
