export function createWorld() {
  return {
    nextEntityId: 1,
    components: new Map()
  };
}

export function createEntity(world) {
  const entity = world.nextEntityId;
  world.nextEntityId += 1;
  return entity;
}

export function addComponent(world, entity, type, value) {
  let store = world.components.get(type);
  if (!store) {
    store = new Map();
    world.components.set(type, store);
  }

  store.set(entity, value);
  return value;
}

export function getComponent(world, entity, type) {
  return world.components.get(type)?.get(entity) ?? null;
}

export function queryEntities(world, componentTypes) {
  if (!componentTypes.length) {
    return [];
  }

  const stores = componentTypes
    .map((type) => world.components.get(type))
    .filter(Boolean)
    .sort((left, right) => left.size - right.size);

  if (stores.length !== componentTypes.length) {
    return [];
  }

  const [primary, ...rest] = stores;
  const matches = [];

  for (const entity of primary.keys()) {
    if (rest.every((store) => store.has(entity))) {
      matches.push(entity);
    }
  }

  return matches;
}
