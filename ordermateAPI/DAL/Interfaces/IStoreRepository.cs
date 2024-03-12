using ordermateAPI.DAL.Models;

namespace ordermateAPI.DAL.Interfaces;

public interface IStoreRepository
{
    Task<StoreModel?> Get(int storeId);
}