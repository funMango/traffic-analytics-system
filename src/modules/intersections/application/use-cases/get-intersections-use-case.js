'use strict';

function createGetIntersectionsUseCase({ intersectionRepository }) {
  return async function getIntersections() {
    return intersectionRepository.findAll();
  };
}

module.exports = {
  createGetIntersectionsUseCase,
};

