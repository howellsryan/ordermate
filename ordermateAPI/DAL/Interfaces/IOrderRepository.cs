using ordermateAPI.DAL.Models;

namespace ordermateAPI.DAL.Interfaces;

public interface IOrderRepository
{
    Task<OrderModel?> Get(string orderNumber);
    Task<IEnumerable<OrderModel>> GetByStoreId(int storeId);
    Task Create(string email, int storeId);
}