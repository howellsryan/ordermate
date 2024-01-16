using ordermateAPI.Models;

namespace ordermateAPI.Services.Interfaces;

public interface IOrderService
{
    Task<OrderModel> GetByOrderNumber(string orderNumber);
    Task Create(string email, int storeId);
}